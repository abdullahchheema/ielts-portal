import { createHash, randomBytes } from 'node:crypto';

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const ACCESS_TTL_SEC = 15 * 60;
export const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;
/** Admin-type roles get a shorter refresh lifetime (spec §63). */
export const ADMIN_REFRESH_TTL_SEC = 12 * 60 * 60;
