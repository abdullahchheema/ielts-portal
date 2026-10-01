import { NextRequest } from 'next/server';
import { backendFetch } from '@/lib/backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Headers that describe the connection to the browser, not the request itself.
const DROP_REQUEST = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'x-forwarded-host', 'x-forwarded-port', 'x-forwarded-proto']);
const DROP_RESPONSE = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection']);

/** The browser calls /api/*; this forwards to the backend with the same method, cookies, body and files. */
async function forward(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const headers = new Headers();
  req.headers.forEach((v, k) => { if (!DROP_REQUEST.has(k)) headers.set(k, v); });
  const hasBody = !['GET', 'HEAD'].includes(req.method);

  const res = await backendFetch(`/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    ...(hasBody ? { duplex: 'half' as const } : {}),
  });

  const out = new Headers();
  res.headers.forEach((v, k) => { if (!DROP_RESPONSE.has(k) && k !== 'set-cookie') out.set(k, v); });
  for (const c of res.headers.getSetCookie()) out.append('set-cookie', c); // keep every cookie, separately
  return new Response(res.status === 204 || res.status === 304 ? null : res.body, { status: res.status, headers: out });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
