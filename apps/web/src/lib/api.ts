/** Thin API client. All calls go through the Next.js proxy at /api so cookies are first-party. */

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, string>,
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

const BASE = '/api';

function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  return document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.slice('csrf_token='.length) ?? '';
}

let refreshing: Promise<boolean> | null = null;

/** Single-flight refresh so parallel 401s trigger one rotation (a second would look like token reuse). */
function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST', credentials: 'include', headers: { 'x-csrf-token': csrfToken() },
  }).then((r) => r.ok).catch(() => false).finally(() => { refreshing = null; });
  return refreshing;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  /** Skip the refresh-and-retry dance (login, refresh itself). */
  noRefresh?: boolean;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body || opts.form ? 'POST' : 'GET');
  const send = () => {
    const headers: Record<string, string> = {};
    if (method !== 'GET') headers['x-csrf-token'] = csrfToken();
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.body); }
    return fetch(`${BASE}${path}`, { method, headers, body, credentials: 'include', cache: 'no-store' });
  };

  let res = await send();
  if (res.status === 401 && !opts.noRefresh && !path.startsWith('/auth/')) {
    if (await refreshSession()) res = await send();
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: Record<string, string>; request_id?: string } } | undefined)?.error;
    throw new ApiError(e?.code ?? 'INTERNAL_ERROR', e?.message ?? 'Something went wrong.', res.status, e?.details, e?.request_id);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}
