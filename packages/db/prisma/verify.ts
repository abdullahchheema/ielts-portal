import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Each check runs in one DO block: it sets up rows, asserts the *bad* statement is
// rejected, then raises VERIFIED_OK so the whole block (and its rows) rolls back.
const SETUP = `
  INSERT INTO users (id, email, password_hash, updated_at) VALUES ('00000000-0000-0000-0000-0000000000a1', 'verify@example.test', 'x', now());
  INSERT INTO student_profiles (id, user_id, first_name, last_name, updated_at) VALUES ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'V', 'T', now());
  INSERT INTO orders (id, reference, student_id, subtotal, total, currency, updated_at) VALUES ('00000000-0000-0000-0000-0000000000a3', 'VERIFY-1', '00000000-0000-0000-0000-0000000000a2', 100, 100, 'PKR', now());
  INSERT INTO payments (id, order_id, amount, currency, updated_at) VALUES ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a3', 100, 'PKR', now());
`;

function expectRejected(name: string, badSql: string, setup = '') {
  return {
    name,
    sql: `DO $$ BEGIN
      ${SETUP}
      ${setup}
      BEGIN
        ${badSql}
        RAISE EXCEPTION 'NOT_BLOCKED';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM = 'NOT_BLOCKED' THEN RAISE; END IF;
      END;
      RAISE EXCEPTION 'VERIFIED_OK';
    END $$;`,
  };
}

const CHECKS = [
  expectRejected('band 6.3 rejected (not a 0.5 step)', `UPDATE student_profiles SET current_band = 6.3 WHERE id = '00000000-0000-0000-0000-0000000000a2';`),
  expectRejected('band 9.5 rejected (> 9)', `UPDATE student_profiles SET target_band = 9.5 WHERE id = '00000000-0000-0000-0000-0000000000a2';`),
  expectRejected('payments cannot be deleted', `DELETE FROM payments WHERE id = '00000000-0000-0000-0000-0000000000a4';`),
  expectRejected('orders cannot be deleted', `DELETE FROM orders WHERE id = '00000000-0000-0000-0000-0000000000a3';`),
  expectRejected('audit_logs cannot be updated',
    `UPDATE audit_logs SET action = 'TAMPERED' WHERE id = '00000000-0000-0000-0000-0000000000a5';`,
    `INSERT INTO audit_logs (id, action, entity_type) VALUES ('00000000-0000-0000-0000-0000000000a5', 'X', 'Y');`),
  expectRejected('audit_logs cannot be deleted',
    `DELETE FROM audit_logs WHERE id = '00000000-0000-0000-0000-0000000000a5';`,
    `INSERT INTO audit_logs (id, action, entity_type) VALUES ('00000000-0000-0000-0000-0000000000a5', 'X', 'Y');`),
  expectRejected('refund cannot exceed captured payment',
    `INSERT INTO refunds (id, payment_id, amount, reason, requested_by) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a4', 150, 'r', '00000000-0000-0000-0000-0000000000a1');`),
  expectRejected('batch capacity must be > 0',
    `INSERT INTO batches (id, course_id, course_version_id, name, start_at, capacity, updated_at)
       SELECT gen_random_uuid(), c.id, v.id, 'bad', now(), 0, now() FROM courses c JOIN course_versions v ON v.course_id = c.id LIMIT 1;`),
  expectRejected('coupon percentage > 100 rejected',
    `INSERT INTO coupons (id, code, discount_type, value) VALUES (gen_random_uuid(), 'BAD', 'PERCENTAGE', 150);`),
];

async function runCheck(c: { name: string; sql: string }) {
  try {
    await prisma.$executeRawUnsafe(c.sql);
    return { name: c.name, ok: false, detail: 'block finished without VERIFIED_OK' };
  } catch (e) {
    const msg = String((e as Error).message);
    return { name: c.name, ok: msg.includes('VERIFIED_OK'), detail: msg.includes('VERIFIED_OK') ? '' : msg.split('\n').slice(-2).join(' ') };
  }
}

async function main() {
  const counts = {
    tables: await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) n FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`,
    rls: await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND c.relname <> '_prisma_migrations'`,
    roles: await prisma.role.count(),
    perms: await prisma.permission.count(),
    courses: await prisma.course.count(),
    sections: await prisma.courseSection.count(),
    items: await prisma.contentItem.count(),
    batches: await prisma.batch.count(),
    settings: await prisma.setting.count(),
    admin: await prisma.user.count({ where: { roles: { some: { role: { name: 'SUPER_ADMIN' } } } } }),
  };
  console.log('tables', Number(counts.tables[0].n), '| with RLS', Number(counts.rls[0].n));
  console.log({ roles: counts.roles, perms: counts.perms, courses: counts.courses, sections: counts.sections, items: counts.items, batches: counts.batches, settings: counts.settings, superAdmins: counts.admin });

  let failed = 0;
  for (const c of CHECKS) {
    const r = await runCheck(c);
    if (!r.ok) failed++;
    console.log(r.ok ? 'PASS' : 'FAIL', '-', r.name, r.detail);
  }
  process.exitCode = failed ? 1 : 0;
}

main().finally(() => prisma.$disconnect());
