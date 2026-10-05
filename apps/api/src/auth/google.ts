import { AppError } from '../common/app-error';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const TIMEOUT_MS = 10_000;

export interface GoogleCredentials { clientId: string; clientSecret: string }
export interface GoogleProfile { email: string; firstName: string; lastName: string }

const failed = () => new AppError('GOOGLE_SIGNIN_FAILED', 401, 'Google sign-in could not be completed. Please try again.');

export function googleAuthorizationUrl(creds: GoogleCredentials, redirectUri: string, state: string): string {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: creds.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account',
  }).toString();
  return url.toString();
}

/** Trades the one-time code for an access token, then reads the verified email from Google's userinfo endpoint. */
export async function googleProfileFromCode(creds: GoogleCredentials, code: string, redirectUri: string): Promise<GoogleProfile> {
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!tokenRes.ok) throw failed();
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string };
  if (!accessToken) throw failed();

  const infoRes = await fetch(USERINFO_URL, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!infoRes.ok) throw failed();
  const info = (await infoRes.json()) as { email?: string; email_verified?: boolean; given_name?: string; family_name?: string };
  if (!info.email || info.email_verified !== true) throw new AppError('GOOGLE_EMAIL_NOT_VERIFIED', 403, 'Your Google account email must be verified to continue.');
  return { email: info.email.trim().toLowerCase(), firstName: info.given_name ?? '', lastName: info.family_name ?? '' };
}
