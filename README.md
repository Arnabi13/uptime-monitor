# Uptime Monitor

Monitor any public website, get an email when it goes down, and share a public status page.
Built with NestJS, PostgreSQL and React, deployed end to end on AWS.

> **Status:** feature-complete and deployed on AWS (EC2 + Docker Compose + Nginx, SQS, SES).
> CloudFront HTTPS, CI/CD (GitHub Actions) and CloudWatch monitoring are described below.

## Tech stack

| Layer | Choice |
|---|---|
| API | NestJS 11 (TypeScript), class-validator |
| Database | PostgreSQL 16 via TypeORM, schema managed by migrations |
| Auth | JWT (HS256) + bcrypt |
| Local dev | Docker Compose |
| Checking engine | AWS SQS (scheduler → queue → worker), standard queue + dead-letter queue |
| Frontend | React 18 + TypeScript, Vite, React Router, TanStack Query, hand-rolled SVG charts |
| Hosting | EC2 (t3.micro) running Docker Compose: Nginx + NestJS + Postgres; CloudFront in front for HTTPS |
| CI/CD | GitHub Actions: tests on every PR, automatic deploy to EC2 on merge to `main` |
| Monitoring | CloudWatch Logs + alarm → SNS email |

## Run it locally

**Prerequisites:** Node 22, Docker Desktop.

```bash
# 1. Start Postgres (also creates the uptime_test database for e2e tests)
docker compose up -d db

# 2. Configure the API
cd backend
cp .env.example .env          # then set JWT_SECRET to a long random string
npm install

# 3. Create the tables, then start the API with hot reload
npm run migration:run
npm run start:dev             # → http://localhost:3000/api/health
```

Then the frontend, in a second terminal:

```bash
cd frontend
npm install
npm run dev                   # → http://localhost:5173 (calls to /api are proxied to :3000)
```

To run the API in a container as well (the way it will run on EC2): `docker compose up --build`.

## API

All routes are prefixed with `/api`. Monitor routes need `Authorization: Bearer <token>`.

| Method | Route | Description |
|---|---|---|
| POST | `/auth/register` | Create an account → `{ accessToken, user }` |
| POST | `/auth/login` | Log in → `{ accessToken, user }` |
| GET | `/auth/me` | Current user |
| GET | `/monitors` | List your monitors |
| POST | `/monitors` | Create a monitor |
| GET | `/monitors/:id` | Get one monitor |
| PATCH | `/monitors/:id` | Edit, pause (`isActive: false`) or resume |
| DELETE | `/monitors/:id` | Delete |
| GET | `/monitors/overview` | Uptime 24h, avg response and last 30 checks for every monitor, in one call |
| GET | `/monitors/:id/stats` | Uptime 24h/7d/30d, avg response, open incident |
| GET | `/monitors/:id/history?range=24h\|7d\|30d` | Response time + up/down in ~90 time buckets |
| GET | `/monitors/:id/incidents` | Last 20 incidents |
| GET | `/status-page` | Your status page link (slug), title, number of public monitors |
| PATCH | `/status-page` | Rename it (`{ "title": "…" }`) |
| POST | `/status-page/rotate` | New random link; the old one 404s |
| GET | `/public/status/:slug` | **No auth.** The public status page data |
| GET | `/health` | App + database health (used by Docker and Nginx) |

Create a monitor:

```bash
curl -X POST http://localhost:3000/api/monitors \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name": "My site", "url": "https://example.com", "intervalSeconds": 60}'
```

Fields: `name`, `url` (required); `method` (`HEAD` | `GET`, default `HEAD`), `intervalSeconds` (60–86400, default 300),
`timeoutMs` (1000–30000, default 10000), `expectedStatusCode` (default: any 2xx/3xx),
`isPublic` (default `false` — show on your public status page).

AWS setup needed before the scheduler/worker will do anything:

1. An SQS standard queue (`SQS_QUEUE_URL`) with a dead-letter queue attached (max receives: 3).
2. An IAM identity with `sqs:SendMessage`/`ReceiveMessage`/`DeleteMessage` on that queue — an access key locally, an EC2 instance role in production.
3. (Optional) An SES sender identity (`ALERT_EMAIL_FROM`), verified — SES sandbox also requires each recipient to be verified. Alerts are skipped (logged only) until this is set.

## Tests

```bash
npm test            # unit tests — SSRF guard (39) + HTTP check / DNS-pinning (6)
npm run test:e2e    # end-to-end against real Postgres (27 cases)

cd ../frontend
npm test            # formatting helpers (vitest)
npm run typecheck
```

## Design decisions

**SSRF protection.** The server makes HTTP requests to URLs users type in, so a user could aim it at
`http://169.254.169.254` (the EC2 metadata service, which hands out IAM credentials), at our own
Postgres, or at anything else in the VPC. Every URL's hostname is resolved, and it is accepted only if
*every* resolved IP is public unicast — one private record is enough to reject, because an attacker can
publish both. Internal names (`localhost`, `*.internal`, single-label names like `db`) are rejected
before DNS. The worker will re-check right before each request to defeat DNS rebinding.

**Abuse limits.** Minimum 60s interval, max monitors per account, and max monitors per host — so the
service can't be turned into a tool for hammering someone's website.

**Race-free limits.** "Count, then insert" has a race: two simultaneous requests can both see 9 and both
insert. Creating a monitor locks the user's row first (`SELECT … FOR UPDATE`), so the requests run one at a
time. The e2e suite fires 8 concurrent creates against a limit of 5 and checks exactly 5 succeed.

**Constraints in the database, not just the code.** Unique `(user_id, url)`, email uniqueness, and
`CHECK` constraints on interval and timeout. The app catches the unique-violation error and returns 409,
instead of checking first (which would race).

**Ownership returns 404, not 403.** Asking for another user's monitor looks the same as asking for one that
doesn't exist, so the API never confirms someone else's ids.

**Auth details.** Same error and same timing for "unknown email" and "wrong password" (no account
enumeration). Password hash is never selected by default. Passwords capped at 72 bytes (bcrypt's limit).
JWT algorithm pinned to HS256. Auth routes have a stricter rate limit.

**Migrations only.** `synchronize` is always off; the schema changes only through reviewed migration files,
which run automatically when the container starts.

**Indexes.** `(is_active, next_check_at)` for the scheduler's "which monitors are due?" query. No separate
`user_id` index — the `(user_id, url)` unique index already serves lookups by user.

**Why SQS between the scheduler and the actual checks (Day 2).** The scheduler's job (decide what's
due) and the worker's job (make an HTTP request to someone else's server and wait on it) have very
different failure modes — a slow or hanging site shouldn't block the next scheduling tick. A queue
decouples them: the scheduler just enqueues and moves on, the worker processes at its own pace, and if
the worker is down for a bit, jobs simply wait in the queue instead of being lost. SQS's at-least-once
delivery also means a check can be safely retried (it's idempotent — running it twice just checks the
URL twice) instead of needing exactly-once semantics.

**Claiming due monitors without double-checking them.** The scheduler runs every minute and asks "which
active monitors are due?" via the `idx_monitors_due` index, then immediately advances `next_check_at`
for everything it finds, inside a transaction using `SELECT ... FOR UPDATE SKIP LOCKED`. That `SKIP
LOCKED` is what makes it safe to run more than one scheduler instance later without two of them
enqueueing the same monitor twice in the same tick.

**Defeating DNS rebinding, not just checking it once.** Day 1's SSRF guard runs at monitor-creation
time, but DNS for a hostname can change afterward — an attacker can point a domain at a public IP until
it's accepted, then repoint it at `169.254.169.254`. The worker calls `assertSafe()` again immediately
before every check, and then connects directly to the IP address that check just validated (via a
custom DNS `lookup` function passed to Node's `http`/`https` request), while still sending the real
hostname in the `Host` header and TLS SNI. So the validation and the connection are guaranteed to be
looking at the same address — there's no window for the DNS answer to change in between.

**One alert per down period, not one per failed check.** A monitor only opens an incident (and sends an
email) once it crosses `ALERT_FAILURE_THRESHOLD` (default 3) *consecutive* failures — one slow response
isn't an outage. Once open, further failures update the monitor's status but don't open a second
incident or send a second email; the incident closes (and a recovery email goes out) on the next
success. This is enforced by always checking for an existing open incident (`resolved_at IS NULL`)
before creating a new one.

**Alerts never bring down the worker.** `EmailService` catches and logs any SES failure instead of
throwing, and quietly no-ops (just logs) if `ALERT_EMAIL_FROM` isn't configured yet. A flaky mail
provider should never stop monitors from being checked.

### Day 3 — frontend and the data behind it

**A `checks` table, so there's something to chart.** Until Day 2 the worker only kept the latest
status. Now every check writes one row (up/down, response time, status code) in the *same transaction*
as the status update, so the chart and the status badge can never disagree. It's the fastest-growing
table (a 60s monitor writes 1,440 rows a day), so it uses a `bigint` id, and a daily job deletes rows
older than 31 days in batches of 5,000, so it never holds locks for long while the worker keeps inserting.

**Aggregate in SQL, ship ~90 numbers.** The chart asks for a range and the API returns ~90 buckets
(`date_bin` into 15-minute / 2-hour / 8-hour slots) with `count(*) FILTER (WHERE is_up)` and `avg()`
computed in Postgres. 30 days of a 60s monitor is 43,200 rows; the browser gets 90.

**Two indexes for two access patterns.** `(monitor_id, checked_at)` B-tree serves "this monitor's checks
since T" and "last 30 checks" (a `LATERAL` join walks it backwards and stops after 30 rows per monitor).
The retention job's `checked_at < X` uses a **BRIN** index instead: rows arrive in time order, so BRIN
stores just min/max per block range, which is a few KB where a B-tree would be MBs.

**One request for the dashboard, not one per row.** `/monitors/overview` returns stats for every monitor
at once, which avoids the N+1 problem over HTTP.

**The public status page leaks nothing the owner didn't choose to show.** Monitors are private unless
`isPublic` is set. The public response has names, status and daily uptime only: no URLs, no failure
causes (they can reveal internals like `ECONNREFUSED`), no emails, no ids. The link is a random 12-char
slug that the owner can rotate. Unknown and malformed slugs get the same 404.

**`Cache-Control: public, max-age=30` on the public page.** If a status link gets shared widely during an
outage (exactly when status pages get traffic), browsers and, from Day 4, CloudFront reuse the response
for 30s, so most requests never reach EC2. The trade-off is that a rotated link can keep working for
up to 30 seconds for someone who opened it recently, and the settings page says so.

**Server state lives in TanStack Query, not `useState`.** It handles caching, de-duplication, polling
every 30s (the scheduler ticks every minute, so faster shows nothing new) and refetching when the tab
regains focus. Mutations update the cache directly (`setQueryData`) so the UI changes instantly.

**Same origin in dev and prod: the app only ever calls `/api/...`.** In dev, Vite proxies `/api` to
Nest. On Day 4, CloudFront will route `/api/*` to EC2 and everything else to S3. One origin means no CORS
preflight on every request and no API URL baked into the build.

**JWT in `localStorage`.** Simple and survives a refresh. The risk is that injected script (XSS) could read
it; an httpOnly cookie avoids that but needs CSRF protection instead. React escapes all output and the app
never uses `dangerouslySetInnerHTML`. Any 401 *on a request that sent a token* logs the user out and
clears the query cache; a 401 from the login form is just "wrong password".

**Hand-rolled SVG chart instead of a chart library.** It's one line, one area, a failure band and a hover
readout. A library would add ~100 KB to a 75 KB (gzipped) bundle. Gaps in the data break the line rather
than drawing a misleading straight segment across a pause.

**Only changed fields are sent on edit**, so renaming a monitor doesn't re-run DNS validation on its URL.

**Container.** Multi-stage build (the TypeScript compiler and dev dependencies never ship), runs as the
non-root `node` user, has a health check, and `exec`s node so it receives `SIGTERM` for graceful shutdown.

## Architecture

```
Browser ──HTTPS──▶ CloudFront ──HTTP:80──▶ EC2 (t3.micro, ap-southeast-2)
                                            ├─ web : Nginx  (React app, /api proxy)
                                            ├─ api : NestJS (API + scheduler + worker)
                                            └─ db  : PostgreSQL 16 (volume)
                                                │
                                   scheduler ──▶ SQS queue ──▶ worker ──▶ target sites
                                                (+ DLQ)           └──▶ SES alert emails
```

Only port 80 (and SSH) is open on the instance; Postgres and the API are reachable only on the
private Compose network. The instance uses an IAM role (no access keys on the server) with the
minimum permissions: SQS on one queue, SES send, and CloudWatch Logs.

## Deployment

On the server (once): install Docker, clone the repo, create `backend/.env` from
`backend/.env.production.example`, then `sh deploy/deploy.sh`. It builds the images, starts the
stack, runs migrations on API startup and prunes old image layers.

`TRUST_PROXY` must equal the real number of proxies in front of the API (CloudFront → Nginx = 2).
Too high and a client could spoof its IP with a fake `X-Forwarded-For` and dodge rate limits.

## CI/CD

- `.github/workflows/ci.yml` — on every PR and push to `main`: backend build + unit tests + e2e
  tests (real Postgres service container running the real migrations), frontend typecheck, tests and
  build, and a Docker build of both images.
- `.github/workflows/deploy.yml` — after CI succeeds on `main`, SSHes to EC2, checks out the exact
  commit CI tested, runs `deploy/deploy.sh`, then polls `/api/health`.
- Secrets: `EC2_HOST`, `EC2_SSH_KEY` (a key pair used only for deploys), optional `EC2_USER` and
  `EC2_APP_DIR`.

## Monitoring

Set `CLOUDWATCH_LOGS=true` in `backend/.env` and redeploy: `docker-compose.cloudwatch.yml` switches
all containers to the `awslogs` driver (log group `uptime-monitor`, 7-day retention). A CloudWatch
alarm on the instance's `StatusCheckFailed` metric notifies an SNS topic by email.

## Project structure

```
frontend/src
├── api/                   fetch client (token, errors), types, React Query hooks
├── auth/                  AuthProvider: login/register/logout, validates a saved token on load
├── components/            StatusPill, CheckStrip (last 30 checks), ResponseChart (SVG), DayBars
├── pages/                 Dashboard, MonitorDetail, MonitorForm (new/edit), StatusPageSettings, PublicStatusPage, Auth
├── lib/format.ts          durations, uptime %, relative times (+ tests)
└── styles.css             design tokens (--um-*) + all styles

backend/src
├── auth/                  register, login, JWT strategy + guard
├── users/                 user entity + service
├── monitors/              monitor entity, DTOs, CRUD service + controller, stats queries
├── incidents/             incident entity + service (open/resolve)
├── checks/                check history entity (one row per check)
├── status-page/           owner settings + the public /public/status/:slug endpoint
├── scheduler/             cron: finds due monitors, enqueues SQS jobs; daily check-history pruning
├── worker/                SQS consumer: HTTP check (+ DNS pinning), updates monitor/incidents
├── queue/                 SQS client wrapper
├── notifications/         SES email alerts
├── common/url-safety/     SSRF guard (+ unit tests)
├── health/                /api/health
├── config/                env validation (app refuses to start on bad config)
└── database/              TypeORM config, CLI data source, migrations
```
