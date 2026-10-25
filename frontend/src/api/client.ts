/**
 * The one place that talks HTTP. Everything else calls api.get/post/... and
 * gets typed data back or an ApiError — never a raw Response.
 */

const BASE_URL = `${import.meta.env.VITE_API_BASE_URL ?? ''}/api`;
const TOKEN_KEY = 'um.token';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Token in localStorage: simple, and it survives a refresh. The trade-off is
 * that any script running on the page (an XSS bug) could read it; an httpOnly
 * cookie can't be read by JS, but then you need CSRF protection instead.
 * React escapes everything it renders and we never use dangerouslySetInnerHTML,
 * which keeps the XSS risk low for this app.
 */
export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode etc. — the session just won't survive a reload */
    }
  },
};

// Set by AuthProvider: an expired/revoked token anywhere logs the user out.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = tokenStore.get();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    // Only treat 401 as "session over" when we actually sent a token — a 401
    // from the login form just means wrong password.
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(res.status, errorMessage(res.status, data));
  }
  return data as T;
}

/** Nest sends { message: string | string[] }; validation errors are an array. */
function errorMessage(status: number, data: unknown): string {
  const message = (data as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.join('. ');
  if (typeof message === 'string') return message;
  if (status === 429) return 'Too many requests. Wait a minute and try again.';
  if (status >= 500) return 'The server ran into a problem. Try again shortly.';
  return `Request failed (${status})`;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: (path: string) => request<void>('DELETE', path),
};
