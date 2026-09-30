import type { Response } from 'express';
import type { Session } from './auth.service';
import { COOKIE } from './guards';
import { ACCESS_TTL_SEC } from './tokens';

/** Sets the httpOnly access/refresh cookies and the readable CSRF cookie. Shared by login and enrollment. */
export function setSessionCookies(res: Response, s: Session, production: boolean) {
  const base = { secure: production, sameSite: 'lax' as const, path: '/' };
  res.cookie(COOKIE.access, s.accessToken, { ...base, httpOnly: true, maxAge: ACCESS_TTL_SEC * 1000 });
  res.cookie(COOKIE.refresh, s.refreshToken, { ...base, httpOnly: true, maxAge: s.refreshTtlSec * 1000 });
  res.cookie(COOKIE.csrf, s.csrfToken, { ...base, httpOnly: false, maxAge: s.refreshTtlSec * 1000 });
}

export function clearSessionCookies(res: Response) {
  for (const name of Object.values(COOKIE)) res.clearCookie(name, { path: '/' });
}
