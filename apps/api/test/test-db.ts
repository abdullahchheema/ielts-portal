import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');

/** Loads the repo .env and returns a connection string pinned to the isolated "test" schema. */
export function testDatabaseUrl(): string {
  const envFile = resolve(ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const base = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!base) throw new Error('DIRECT_URL or DATABASE_URL must be set to run integration tests.');
  const url = new URL(base);
  url.searchParams.delete('pgbouncer');
  url.searchParams.set('schema', 'test'); // tests NEVER touch the public schema
  return url.toString();
}

export const REPO_ROOT = ROOT;
