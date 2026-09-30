/**
 * Development helper: wipes every application table (schema, triggers and RLS stay) and reloads reference + demo data.
 * Refuses to run against production.
 */
import { prisma } from './seed';
import { seedDemo } from './seed-demo';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset the database with NODE_ENV=production.');
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? '').hostname; } catch { return 'unknown host'; } })();
  console.log(`Resetting all application data on ${host} …`);

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // TRUNCATE does not fire the row-level "no delete" triggers, which is what makes a full reset possible.
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  console.log(`Cleared ${tables.length} tables.`);

  await seedDemo();
  console.log('\nDone. Log in with any demo account — password: DemoPass123\n  admin@example.com · ahmed.khan@example.com · sara.ahmed@example.com · student1@example.com … student8@example.com');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
