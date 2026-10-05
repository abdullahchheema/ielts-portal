import { z } from 'zod';

const optional = z.string().min(1).optional();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: optional,
  // Optional in dev: features degrade gracefully (in-memory limiter, logged emails, no uploads).
  REDIS_URL: optional,
  // S3-compatible storage (Cloudflare R2, Supabase Storage, AWS S3). Unset = private local folder (dev only).
  S3_ENDPOINT: optional,
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
  S3_BUCKET: optional,
  DISABLE_SWEEPER: z.enum(['true', 'false']).default('false'),
  // Two-factor login for staff. Unset = on in production, off in development. The code stays in place; this just switches it.
  TWO_FACTOR_ENABLED: z.enum(['true', 'false']).optional(),
  RESEND_API_KEY: optional,
  // The owner can remove any account, including other Super Admins. Nobody can remove the owner.
  OWNER_EMAIL: z.string().trim().toLowerCase().email().optional(),
  // "Continue with Google" is shown only when both are set.
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  MAIL_FROM: z.string().default('IELTS Portal <no-reply@localhost>'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  APP_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:4000'),
}).transform((c) => ({ ...c, TWO_FACTOR_ENABLED: c.TWO_FACTOR_ENABLED ?? (c.NODE_ENV === 'production' ? ('true' as const) : ('false' as const)) }));

export type AppConfig = z.infer<typeof schema>;

/** Fails fast with a readable list of missing/invalid variables. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
