import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@ielts/db';
import { REPO_ROOT, testDatabaseUrl } from './test-db';

/** Rebuilds the isolated "test" schema (migrations + seed) once per test run. */
export default async function setup() {
  const url = testDatabaseUrl();
  const admin = new PrismaClient({ datasourceUrl: url });
  if (process.env.REUSE_TEST_DB) {
    // Fast path for local iteration: keep the existing, already-seeded test schema.
    const [{ n }] = await admin.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) n FROM information_schema.tables WHERE table_schema = 'test' AND table_name = 'roles'`);
    await admin.$disconnect();
    if (Number(n) > 0) return;
    const again = new PrismaClient({ datasourceUrl: url });
    await again.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS "test"');
    await again.$disconnect();
    return migrateAndSeed(url);
  }
  await admin.$executeRawUnsafe('DROP SCHEMA IF EXISTS "test" CASCADE'); // literal: only ever the test schema
  await admin.$executeRawUnsafe('CREATE SCHEMA "test"');
  await admin.$disconnect();
  migrateAndSeed(url);
}

function migrateAndSeed(url: string) {
  const env = {
    ...process.env,
    DATABASE_URL: url,
    DIRECT_URL: url,
    SEED_ADMIN_EMAIL: 'admin@test.local',
    SEED_ADMIN_PASSWORD: 'TestAdminPass123',
  };
  const cwd = resolve(REPO_ROOT, 'packages/db');
  execSync('npx prisma migrate deploy', { cwd, env, stdio: 'pipe' });
  execSync('npx tsx prisma/seed.ts', { cwd, env, stdio: 'pipe' });
}
