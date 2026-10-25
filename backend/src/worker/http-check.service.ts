import * as http from 'node:http';
import * as https from 'node:https';
import { Injectable } from '@nestjs/common';

export interface CheckInput {
  /** Normalized URL (scheme, hostname, path, query). */
  url: string;
  /** Exact IP the worker just resolved and validated. We connect to THIS, not to
   *  whatever DNS says at request time — that's what defeats DNS rebinding. */
  pinnedIp: string;
  method: 'HEAD' | 'GET';
  timeoutMs: number;
  /** null = any 2xx/3xx counts as up. */
  expectedStatusCode: number | null;
}

export interface CheckResult {
  up: boolean;
  statusCode?: number;
  /** Time until the response headers arrived (connect + TLS + server think time). */
  responseTimeMs?: number;
  /** Short human-readable reason, stored on the incident / logged either way. */
  cause: string;
}

/**
 * Makes the actual HTTP(S) request for one check.
 *
 * Uses Node's http/https modules directly (not fetch) so we can pass a custom
 * `lookup` function that forces the connection to `pinnedIp` instead of doing
 * a fresh DNS lookup. The Host header / TLS SNI still use the real hostname
 * (via `servername` and the request's `hostname`), so this is transparent to
 * the server — but it closes the DNS-rebinding window between our SSRF check
 * and the actual connection, since both now agree on the same address.
 */
@Injectable()
export class HttpCheckService {
  check(input: CheckInput): Promise<CheckResult> {
    const parsed = new URL(input.url);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;

    return new Promise((resolve) => {
      const startedAt = performance.now();
      const req = transport.request(
        {
          method: input.method,
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: `${parsed.pathname}${parsed.search}`,
          timeout: input.timeoutMs,
          agent: false, // never reuse a connection pinned to a different IP
          // Node's net module calls this with `{ all: true }` and expects the
          // array form of the callback in that case — the single-address form
          // silently produces ERR_INVALID_IP_ADDRESS otherwise.
          lookup: (
            _hostname: string,
            opts: { all?: boolean },
            callback: (...args: any[]) => void,
          ) => {
            const family = input.pinnedIp.includes(':') ? 6 : 4;
            if (opts?.all) {
              callback(null, [{ address: input.pinnedIp, family }]);
            } else {
              callback(null, input.pinnedIp, family);
            }
          },
          ...(isHttps ? { servername: parsed.hostname } : {}),
        } as http.RequestOptions,
        (res) => {
          // Measured when headers arrive, not when the body finishes: that's what
          // "response time" means on most status pages, and it ignores page size.
          const responseTimeMs = Math.round(performance.now() - startedAt);
          res.resume(); // drain and discard the body — we only care about the status
          res.on('end', () => {
            const statusCode = res.statusCode ?? 0;
            const up = input.expectedStatusCode
              ? statusCode === input.expectedStatusCode
              : statusCode >= 200 && statusCode < 400;
            resolve({
              up,
              statusCode,
              responseTimeMs,
              cause: up ? `HTTP ${statusCode}` : `unexpected HTTP ${statusCode}`,
            });
          });
        },
      );

      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (err: NodeJS.ErrnoException) => {
        resolve({ up: false, cause: err.message === 'timeout' ? 'timeout' : err.code ?? err.message });
      });
      req.end();
    });
  }
}
