import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { HttpCheckService } from './http-check.service';

describe('HttpCheckService', () => {
  let service: HttpCheckService;
  let server: http.Server;
  let port: number;
  let lastRequestHeaders: http.IncomingHttpHeaders | undefined;

  beforeAll((done) => {
    service = new HttpCheckService();
    server = http.createServer((req, res) => {
      lastRequestHeaders = req.headers;
      if (req.url === '/slow') {
        setTimeout(() => res.end('too slow'), 500);
        return;
      }
      if (req.url === '/teapot') {
        res.writeHead(418).end();
        return;
      }
      res.writeHead(200).end('ok');
    });
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      done();
    });
  });

  afterAll((done) => {
    server.close(() => done());
  });

  it('reports up for a 2xx response', async () => {
    const result = await service.check({
      url: `http://this-name-does-not-resolve.invalid:${port}/`,
      pinnedIp: '127.0.0.1',
      method: 'GET',
      timeoutMs: 2000,
      expectedStatusCode: null,
    });
    expect(result.up).toBe(true);
    expect(result.statusCode).toBe(200);
  });

  it('connects to pinnedIp, ignoring whatever the hostname would really resolve to — this is the DNS-rebinding defense', async () => {
    // The hostname here is nonsense and would never resolve on its own.
    // The request only succeeds because pinnedIp overrides DNS entirely.
    await service.check({
      url: `http://totally-fake-hostname-xyz.invalid:${port}/`,
      pinnedIp: '127.0.0.1',
      method: 'GET',
      timeoutMs: 2000,
      expectedStatusCode: null,
    });
    // The Host header still reflects the real hostname, so the destination
    // server sees a normal request — only the connection is pinned.
    expect(lastRequestHeaders?.host).toBe(`totally-fake-hostname-xyz.invalid:${port}`);
  });

  it('reports down when the status does not match expectedStatusCode', async () => {
    const result = await service.check({
      url: `http://x.invalid:${port}/`,
      pinnedIp: '127.0.0.1',
      method: 'GET',
      timeoutMs: 2000,
      expectedStatusCode: 201,
    });
    expect(result.up).toBe(false);
    expect(result.statusCode).toBe(200);
  });

  it('treats a 4xx/5xx as down when no expectedStatusCode is set', async () => {
    const result = await service.check({
      url: `http://x.invalid:${port}/teapot`,
      pinnedIp: '127.0.0.1',
      method: 'GET',
      timeoutMs: 2000,
      expectedStatusCode: null,
    });
    expect(result.up).toBe(false);
    expect(result.statusCode).toBe(418);
  });

  it('reports down with cause "timeout" when the server is too slow', async () => {
    const result = await service.check({
      url: `http://x.invalid:${port}/slow`,
      pinnedIp: '127.0.0.1',
      method: 'GET',
      timeoutMs: 100,
      expectedStatusCode: null,
    });
    expect(result.up).toBe(false);
    expect(result.cause).toBe('timeout');
  });

  it('reports down when the pinned IP refuses the connection', async () => {
    const result = await service.check({
      url: `http://x.invalid:1/`, // port 1 — nothing listens there
      pinnedIp: '127.0.0.1',
      method: 'GET',
      timeoutMs: 1000,
      expectedStatusCode: null,
    });
    expect(result.up).toBe(false);
    expect(result.statusCode).toBeUndefined();
  });
});
