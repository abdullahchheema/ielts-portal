import { NextRequest, NextResponse } from 'next/server';

/**
 * Cheap first gate for the three portals: no session cookie means no page.
 * The API is the real authority — it re-checks the session and the role on every request.
 */
export function proxy(req: NextRequest) {
  if (req.cookies.has('access_token') || req.cookies.has('refresh_token')) return NextResponse.next();
  const url = req.nextUrl.clone();
  const next = req.nextUrl.pathname + req.nextUrl.search;
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/student/:path*', '/teacher/:path*', '/admin/:path*'] };
