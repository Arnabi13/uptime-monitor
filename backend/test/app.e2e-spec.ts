/**
 * End-to-end tests against a REAL PostgreSQL database (uptime_test).
 * Only DNS is faked, so the tests are deterministic and work offline.
 *
 * Run: npm run test:e2e   (needs Postgres running — e.g. `docker compose up -d db`)
 */
import 'dotenv/config';

// Test settings must be in place before AppModule is imported.
process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.DB_TEST_NAME ?? 'uptime_test';
process.env.MAX_MONITORS_PER_USER = '5';
process.env.MAX_MONITORS_PER_HOST = '2';
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-123';
process.env.AWS_REGION ??= 'ap-southeast-2';
process.env.SQS_QUEUE_URL ??= 'https://sqs.ap-southeast-2.amazonaws.com/000000000000/test-queue';
process.env.ENABLE_SCHEDULER = 'false';
process.env.ENABLE_WORKER = 'false';

import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DNS_LOOKUP, DnsLookup } from '../src/common/url-safety/url-safety.service';
import { Incident } from '../src/incidents/incident.entity';
import { configureApp } from '../src/main';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { HttpCheckService } from '../src/worker/http-check.service';
import { WorkerService } from '../src/worker/worker.service';

const fakeDns: Record<string, string[]> = {
  'example.com': ['93.184.215.14'],
  'example.org': ['93.184.215.15'],
  'api.example.net': ['93.184.215.16'],
  'sneaky.example.com': ['10.0.0.12'],
};
const lookup: DnsLookup = async (host) => {
  if (!fakeDns[host]) throw new Error('ENOTFOUND');
  return fakeDns[host];
};

describe('Uptime Monitor API (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DNS_LOOKUP)
      .useValue(lookup)
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication, app.get(ConfigService));
    await app.init();

    // Fresh schema for every run, built by the real migrations.
    const ds = app.get(DataSource);
    await ds.dropDatabase();
    await ds.runMigrations();

    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  let emailCounter = 0;
  async function signUp(): Promise<string> {
    const res = await http
      .post('/api/auth/register')
      .send({ email: `user${++emailCounter}@test.com`, password: 'password123' })
      .expect(201);
    return res.body.accessToken;
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  describe('auth', () => {
    it('registers, logs in (case-insensitive email) and returns the current user', async () => {
      await http
        .post('/api/auth/register')
        .send({ email: 'Ana@Example.com', password: 'password123' })
        .expect(201);

      const login = await http
        .post('/api/auth/login')
        .send({ email: 'ana@example.com', password: 'password123' })
        .expect(200);

      const me = await http.get('/api/auth/me').set(auth(login.body.accessToken)).expect(200);
      expect(me.body.email).toBe('ana@example.com');
    });

    it('rejects a duplicate email with 409', async () => {
      await http
        .post('/api/auth/register')
        .send({ email: 'ANA@example.com', password: 'password123' })
        .expect(409);
    });

    it('gives the same 401 for a wrong password and an unknown email', async () => {
      const wrongPw = await http
        .post('/api/auth/login')
        .send({ email: 'ana@example.com', password: 'nope-nope' })
        .expect(401);
      const unknown = await http
        .post('/api/auth/login')
        .send({ email: 'ghost@example.com', password: 'nope-nope' })
        .expect(401);
      expect(wrongPw.body.message).toBe(unknown.body.message);
    });

    it('never returns the password hash', async () => {
      const res = await http
        .post('/api/auth/register')
        .send({ email: 'hash@example.com', password: 'password123' })
        .expect(201);
      expect(JSON.stringify(res.body)).not.toContain('password');
    });

    it('rejects weak passwords and invalid emails', async () => {
      await http.post('/api/auth/register').send({ email: 'a@b.com', password: 'short' }).expect(400);
      await http.post('/api/auth/register').send({ email: 'nope', password: 'password123' }).expect(400);
    });

    it('rejects requests without a valid token', async () => {
      await http.get('/api/monitors').expect(401);
      await http.get('/api/monitors').set(auth('not.a.jwt')).expect(401);
    });
  });

  describe('monitors', () => {
    it('creates a monitor with sensible defaults and normalised URL', async () => {
      const token = await signUp();
      const res = await http
        .post('/api/monitors')
        .set(auth(token))
        .send({ name: '  Homepage  ', url: 'https://EXAMPLE.com/#top' })
        .expect(201);

      expect(res.body).toMatchObject({
        name: 'Homepage',
        url: 'https://example.com/',
        host: 'example.com',
        method: 'HEAD',
        intervalSeconds: 300,
        timeoutMs: 10000,
        expectedStatusCode: null,
        isActive: true,
        status: 'pending',
      });
    });

    it('blocks SSRF targets', async () => {
      const token = await signUp();
      for (const url of [
        'http://169.254.169.254/latest/meta-data/',
        'http://localhost:3000',
        'http://db:5432',
        'http://[::1]',
        'https://sneaky.example.com', // public-looking name, private IP
      ]) {
        await http.post('/api/monitors').set(auth(token)).send({ name: 'x', url }).expect(400);
      }
    });

    it('validates interval, timeout and unknown fields', async () => {
      const token = await signUp();
      const base = { name: 'x', url: 'https://example.com' };
      await http.post('/api/monitors').set(auth(token)).send({ ...base, intervalSeconds: 10 }).expect(400);
      await http.post('/api/monitors').set(auth(token)).send({ ...base, timeoutMs: 60_000 }).expect(400);
      await http.post('/api/monitors').set(auth(token)).send({ ...base, userId: 'someone-else' }).expect(400);
    });

    it('rejects the same URL twice for one user (409), but allows it for another user', async () => {
      const a = await signUp();
      const b = await signUp();
      const body = { name: 'x', url: 'https://example.org/status' };
      await http.post('/api/monitors').set(auth(a)).send(body).expect(201);
      await http.post('/api/monitors').set(auth(a)).send(body).expect(409);
      await http.post('/api/monitors').set(auth(b)).send(body).expect(201);
    });

    it('enforces the per-host limit (2)', async () => {
      const token = await signUp();
      for (const path of ['a', 'b']) {
        await http
          .post('/api/monitors')
          .set(auth(token))
          .send({ name: path, url: `https://example.com/${path}` })
          .expect(201);
      }
      await http
        .post('/api/monitors')
        .set(auth(token))
        .send({ name: 'c', url: 'https://example.com/c' })
        .expect(403);
    });

    it('enforces the per-user limit (5) even under concurrent requests', async () => {
      const token = await signUp();
      // 8 creates fired at once, spread across hosts so the per-host limit isn't what stops them.
      const hosts = ['example.com', 'example.org', 'api.example.net', '8.8.8.8', '1.1.1.1', '9.9.9.9', '8.8.4.4', '1.0.0.1'];
      const results = await Promise.all(
        hosts.map((h, i) =>
          http.post('/api/monitors').set(auth(token)).send({ name: `m${i}`, url: `https://${h}/p${i}` }),
        ),
      );
      const created = results.filter((r) => r.status === 201).length;
      const refused = results.filter((r) => r.status === 403).length;
      expect(created).toBe(5);
      expect(refused).toBe(3);

      const list = await http.get('/api/monitors').set(auth(token)).expect(200);
      expect(list.body).toHaveLength(5);
    });

    it("hides other users' monitors behind 404", async () => {
      const owner = await signUp();
      const stranger = await signUp();
      const created = await http
        .post('/api/monitors')
        .set(auth(owner))
        .send({ name: 'mine', url: 'https://example.com' })
        .expect(201);
      const id = created.body.id;

      await http.get(`/api/monitors/${id}`).set(auth(stranger)).expect(404);
      await http.patch(`/api/monitors/${id}`).set(auth(stranger)).send({ name: 'hacked' }).expect(404);
      await http.delete(`/api/monitors/${id}`).set(auth(stranger)).expect(404);
      await http.get(`/api/monitors/${id}`).set(auth(owner)).expect(200);
      expect((await http.get('/api/monitors').set(auth(stranger))).body).toHaveLength(0);
    });

    it('pauses, resumes, edits, re-validates new URLs, and deletes', async () => {
      const token = await signUp();
      const { body: m } = await http
        .post('/api/monitors')
        .set(auth(token))
        .send({ name: 'api', url: 'https://api.example.net/health' })
        .expect(201);

      const paused = await http.patch(`/api/monitors/${m.id}`).set(auth(token)).send({ isActive: false }).expect(200);
      expect(paused.body).toMatchObject({ isActive: false, status: 'paused' });

      const resumed = await http.patch(`/api/monitors/${m.id}`).set(auth(token)).send({ isActive: true }).expect(200);
      expect(resumed.body).toMatchObject({ isActive: true, status: 'pending' });

      const edited = await http
        .patch(`/api/monitors/${m.id}`)
        .set(auth(token))
        .send({ name: 'API health', method: 'GET', expectedStatusCode: 200 })
        .expect(200);
      expect(edited.body).toMatchObject({ name: 'API health', method: 'GET', expectedStatusCode: 200 });

      await http
        .patch(`/api/monitors/${m.id}`)
        .set(auth(token))
        .send({ url: 'http://169.254.169.254' })
        .expect(400);

      await http.delete(`/api/monitors/${m.id}`).set(auth(token)).expect(204);
      await http.get(`/api/monitors/${m.id}`).set(auth(token)).expect(404);
    });

    it('rejects malformed ids with 400', async () => {
      const token = await signUp();
      await http.get('/api/monitors/not-a-uuid').set(auth(token)).expect(400);
    });
  });

  describe('worker (incident lifecycle)', () => {
    // ALERT_FAILURE_THRESHOLD is 3 by default (not overridden for tests).
    const THRESHOLD = 3;

    it('opens exactly one incident after 3 consecutive failures, sends no alert before that, and resolves on recovery', async () => {
      const token = await signUp();
      const { body: m } = await http
        .post('/api/monitors')
        .set(auth(token))
        .send({ name: 'flaky', url: 'https://example.com/flaky' })
        .expect(201);

      const worker = app.get(WorkerService);
      const httpCheck = app.get(HttpCheckService);
      const incidents = app.get(DataSource).getRepository(Incident);

      const checkSpy = jest.spyOn(httpCheck, 'check');

      // Fail twice — below the threshold, so no incident yet.
      checkSpy.mockResolvedValue({ up: false, statusCode: 503, cause: 'unexpected HTTP 503' });
      await worker.runJob({ monitorId: m.id });
      await worker.runJob({ monitorId: m.id });
      expect(await incidents.findOne({ where: { monitorId: m.id } })).toBeNull();

      let status = (await http.get(`/api/monitors/${m.id}`).set(auth(token))).body;
      expect(status).toMatchObject({ status: 'down', consecutiveFailures: 2 });

      // The 3rd consecutive failure crosses the threshold — exactly one incident opens.
      await worker.runJob({ monitorId: m.id });
      const open = await incidents.findOne({ where: { monitorId: m.id } });
      expect(open).toMatchObject({ cause: 'unexpected HTTP 503', resolvedAt: null });

      // A 4th failure must NOT open a second incident (one alert per down period).
      await worker.runJob({ monitorId: m.id });
      expect(await incidents.count({ where: { monitorId: m.id } })).toBe(1);

      status = (await http.get(`/api/monitors/${m.id}`).set(auth(token))).body;
      expect(status).toMatchObject({ status: 'down', consecutiveFailures: THRESHOLD + 1 });

      // Recovery resolves the incident and resets the failure count.
      checkSpy.mockResolvedValue({ up: true, statusCode: 200, cause: 'HTTP 200' });
      await worker.runJob({ monitorId: m.id });

      status = (await http.get(`/api/monitors/${m.id}`).set(auth(token))).body;
      expect(status).toMatchObject({ status: 'up', consecutiveFailures: 0 });

      const resolved = await incidents.findOne({ where: { monitorId: m.id } });
      expect(resolved?.resolvedAt).not.toBeNull();

      checkSpy.mockRestore();
    });

    it('treats a now-unsafe URL (DNS rebinding) as a failed check instead of throwing', async () => {
      const token = await signUp();
      const { body: m } = await http
        .post('/api/monitors')
        .set(auth(token))
        .send({ name: 'rebind-target', url: 'https://example.org/' })
        .expect(201);

      const worker = app.get(WorkerService);
      // Simulate DNS now answering with a private address for this hostname.
      fakeDns['example.org'] = ['10.0.0.55'];

      await expect(worker.runJob({ monitorId: m.id })).resolves.toBeUndefined();

      const status = (await http.get(`/api/monitors/${m.id}`).set(auth(token))).body;
      expect(status).toMatchObject({ status: 'down', consecutiveFailures: 1 });

      fakeDns['example.org'] = ['93.184.215.15']; // restore for any later tests
    });

    it('skips a monitor that was paused after the scheduler enqueued it', async () => {
      const token = await signUp();
      const { body: m } = await http
        .post('/api/monitors')
        .set(auth(token))
        .send({ name: 'paused-mid-flight', url: 'https://example.com/paused' })
        .expect(201);
      await http.patch(`/api/monitors/${m.id}`).set(auth(token)).send({ isActive: false }).expect(200);

      const worker = app.get(WorkerService);
      const httpCheck = app.get(HttpCheckService);
      const checkSpy = jest.spyOn(httpCheck, 'check');

      await worker.runJob({ monitorId: m.id });
      expect(checkSpy).not.toHaveBeenCalled();

      checkSpy.mockRestore();
    });
  });

  describe('history, stats and overview (Day 3)', () => {
    async function monitorWithChecks(results: boolean[]) {
      const token = await signUp();
      const { body: m } = await http
        .post('/api/monitors')
        .set(auth(token))
        .send({ name: 'charted', url: 'https://example.com/charted' })
        .expect(201);
      const worker = app.get(WorkerService);
      const checkSpy = jest.spyOn(app.get(HttpCheckService), 'check');
      for (const up of results) {
        checkSpy.mockResolvedValueOnce(
          up
            ? { up: true, statusCode: 200, responseTimeMs: 100, cause: 'HTTP 200' }
            : { up: false, statusCode: 500, responseTimeMs: 300, cause: 'unexpected HTTP 500' },
        );
        await worker.runJob({ monitorId: m.id });
      }
      checkSpy.mockRestore();
      return { token, id: m.id as string };
    }

    it('records every check and reports uptime and average response time of successful checks', async () => {
      const { token, id } = await monitorWithChecks([true, true, true, false]);

      const stats = (await http.get(`/api/monitors/${id}/stats`).set(auth(token)).expect(200)).body;
      expect(stats).toMatchObject({
        uptime: { h24: 75, d7: 75, d30: 75 },
        avgResponseMs24h: 100, // the failed check's 300ms is excluded
        checks24h: 4,
        openIncident: null,
      });

      const history = (await http.get(`/api/monitors/${id}/history?range=24h`).set(auth(token)).expect(200)).body;
      expect(history.reduce((n: number, b: { total: number }) => n + b.total, 0)).toBe(4);

      await http.get(`/api/monitors/${id}/history?range=1y`).set(auth(token)).expect(400);
    });

    it('returns an overview for all monitors, with recent checks oldest first', async () => {
      const { token, id } = await monitorWithChecks([false, true]);
      const overview = (await http.get('/api/monitors/overview').set(auth(token)).expect(200)).body;
      expect(overview).toHaveLength(1);
      expect(overview[0]).toMatchObject({ monitorId: id, uptime24h: 50, avgResponseMs24h: 100 });
      expect(overview[0].recent.map((c: { up: boolean }) => c.up)).toEqual([false, true]);
    });

    it('lists incidents and shows the open one in stats', async () => {
      const { token, id } = await monitorWithChecks([false, false, false]);
      const stats = (await http.get(`/api/monitors/${id}/stats`).set(auth(token)).expect(200)).body;
      expect(stats.openIncident).toMatchObject({ cause: 'unexpected HTTP 500' });
      const incidents = (await http.get(`/api/monitors/${id}/incidents`).set(auth(token)).expect(200)).body;
      expect(incidents).toHaveLength(1);
    });

    it("hides other users' stats, history and incidents behind 404", async () => {
      const { id } = await monitorWithChecks([true]);
      const stranger = await signUp();
      for (const path of ['stats', 'history', 'incidents']) {
        await http.get(`/api/monitors/${id}/${path}`).set(auth(stranger)).expect(404);
      }
      expect((await http.get('/api/monitors/overview').set(auth(stranger))).body).toEqual([]);
    });

    it('prunes checks older than the retention period, and nothing newer', async () => {
      const { token, id } = await monitorWithChecks([true, true]);
      const ds = app.get(DataSource);
      await ds.query(
        `INSERT INTO checks (monitor_id, checked_at, is_up) VALUES ($1, now() - interval '40 days', true)`,
        [id],
      );
      const deleted = await app.get(SchedulerService).deleteOldChecks();
      expect(deleted).toBe(1);
      const stats = (await http.get(`/api/monitors/${id}/stats`).set(auth(token))).body;
      expect(stats.checks24h).toBe(2);
    });
  });

  describe('public status page (Day 3)', () => {
    it('shows only public, active monitors — name and status, never the URL', async () => {
      const token = await signUp();
      await http
        .post('/api/monitors')
        .set(auth(token))
        .send({ name: 'Public API', url: 'https://api.example.net/secret-path', isPublic: true })
        .expect(201);
      await http
        .post('/api/monitors')
        .set(auth(token))
        .send({ name: 'Private admin', url: 'https://example.com/admin' })
        .expect(201);

      const settings = (await http.get('/api/status-page').set(auth(token)).expect(200)).body;
      expect(settings).toMatchObject({ title: 'Service status', publicMonitors: 1 });
      expect(settings.slug).toMatch(/^[a-z0-9]{12}$/);

      const res = await http.get(`/api/public/status/${settings.slug}`).expect(200); // no token
      expect(res.headers['cache-control']).toBe('public, max-age=30');
      expect(res.body.monitors).toHaveLength(1);
      expect(res.body.monitors[0]).toMatchObject({ name: 'Public API', status: 'pending' });
      expect(res.body.monitors[0].days).toHaveLength(30);
      expect(res.body.overall).toBe('operational');
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('example');
      expect(raw).not.toContain('Private admin');
      expect(raw).not.toContain('@test.com');
    });

    it('renames the page, and rotating the slug kills the old link', async () => {
      const token = await signUp();
      const before = (await http.get('/api/status-page').set(auth(token))).body;
      await http.patch('/api/status-page').set(auth(token)).send({ title: 'Acme status' }).expect(200);
      const after = (await http.post('/api/status-page/rotate').set(auth(token)).expect(200)).body;

      expect(after.slug).not.toBe(before.slug);
      await http.get(`/api/public/status/${before.slug}`).expect(404);
      const page = (await http.get(`/api/public/status/${after.slug}`).expect(200)).body;
      expect(page).toMatchObject({ title: 'Acme status', overall: 'no_monitors' });
    });

    it('gives 404 for unknown and malformed slugs', async () => {
      await http.get('/api/public/status/doesnotexist0').expect(404);
      await http.get('/api/public/status/../../etc').expect(404);
      await http.get("/api/public/status/x'; DROP TABLE users;--").expect(404);
    });
  });

  it('reports health with the database up', async () => {
    const res = await http.get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
  });
});
