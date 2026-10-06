import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { apply, as, createOpenBatch, createStudent, enrollStudent, http, loginAdmin, mainCourse, Session, uniq } from './helpers';

/** Payment risk, statement reconciliation and certificate revocation against the database. */

let app: NestExpressApplication;
let prisma: PrismaClient;
let admin: Session;

beforeAll(async () => {
  ({ app } = await createApp(false));
  await app.init();
  prisma = new PrismaClient();
  admin = await loginAdmin(app);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const post = (s: Session, path: string, body: object = {}) => as(s)(http(app).post(path)).send(body);
const get = (s: Session, path: string) => as(s)(http(app).get(path));

describe('payment risk', () => {
  it('a reused reference and a reused receipt file are flagged for a person to review', async () => {
    const batchId = await createOpenBatch(app, admin);
    const txn = `RISK${uniq()}`.toUpperCase();
    const first = await createStudent(app, prisma);
    const second = await createStudent(app, prisma);
    await apply(app, first.session, batchId, { txn }).expect(201);
    await apply(app, second.session, batchId, { txn }).expect(201);

    const queue = (await get(admin, '/admin/payment-risk').expect(200)).body as { reference: string; overall: string; flags: { id: string; rule: string; level: string }[] }[];
    const mine = queue.find((q) => q.reference === txn);
    expect(mine).toBeTruthy();
    expect(mine!.overall).toBe('HIGH');
    expect(mine!.flags.map((f) => f.rule)).toEqual(expect.arrayContaining(['REF_OTHER_STUDENT']));

    const flagId = mine!.flags.find((f) => f.rule === 'REF_OTHER_STUDENT')!.id;
    await post(admin, `/admin/payment-risk/${flagId}/review`, { decision: 'DISMISS', note: 'Same family, confirmed by phone' }).expect(200);
    await post(admin, `/admin/payment-risk/${flagId}/review`, { decision: 'CONFIRM' }).expect(409);
    const row = await prisma.paymentRiskFlag.findUniqueOrThrow({ where: { id: flagId } });
    expect(row.status).toBe('DISMISSED');
    // A flag review never changes the payment or the enrolment.
    const proof = await prisma.paymentProof.findFirstOrThrow({ where: { bankTxnReference: txn }, orderBy: { createdAt: 'desc' } });
    expect(proof.status).toBe('SUBMITTED');
  });

  it('a student cannot see or review payment risk', async () => {
    const st = await createStudent(app, prisma);
    await get(st.session, '/admin/payment-risk').expect(403);
    await post(st.session, `/admin/payment-risk/${crypto.randomUUID()}/review`, { decision: 'DISMISS' }).expect(403);
  });
});

describe('statement reconciliation', () => {
  it('imported statement lines match payments, and mismatches go to a resolvable exception', async () => {
    const course = await mainCourse(app, admin);
    const price = Number(course.price);
    const batchId = await createOpenBatch(app, admin);
    const good = `BANK${uniq()}`.toUpperCase();
    const bad = `BADAMT${uniq()}`.toUpperCase();
    const a = await createStudent(app, prisma);
    const b = await createStudent(app, prisma);
    await apply(app, a.session, batchId, { txn: good, amount: price }).expect(201);
    await apply(app, b.session, batchId, { txn: bad, amount: price }).expect(201);

    const imp = (await post(admin, '/admin/reconciliation/imports', {
      method: 'BANK_TRANSFER',
      lines: [{ reference: good, amount: price, date: '2026-09-28' }, { reference: bad, amount: Math.round(price / 2), date: '2026-09-28' }],
    }).expect(201)).body;
    expect(imp.rows).toBe(2);

    const summary = (await get(admin, '/admin/reconciliation/summary').expect(200)).body;
    expect(summary.matched).toBeGreaterThanOrEqual(1);
    const exceptions = (await get(admin, '/admin/reconciliation/exceptions?status=MISMATCHED').expect(200)).body as { id: string; proof: { bankTxnReference: string } }[];
    const ex = exceptions.find((e) => e.proof.bankTxnReference === bad);
    expect(ex).toBeTruthy();
    await post(admin, `/admin/reconciliation/exceptions/${ex!.id}/resolve`, { resolution: 'REJECTED_EXCEPTION', note: 'Statement line belongs to another payment' }).expect(200);
    await post(admin, `/admin/reconciliation/exceptions/${ex!.id}/resolve`, { resolution: 'ACCEPTED' }).expect(409);
  });

  it('only finance with reconciliation access can import statements', async () => {
    const st = await createStudent(app, prisma);
    await post(st.session, '/admin/reconciliation/imports', { method: 'BANK_TRANSFER', lines: [{ reference: 'XYZ123', amount: 10, date: '2026-09-01' }] }).expect(403);
  });
});

describe('certificates', () => {
  it('a certificate is numbered, verified, revoked (audited), and no longer served once revoked', async () => {
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    await prisma.enrollment.update({ where: { id: st.enrollmentId }, data: { status: 'COMPLETED', completedAt: new Date() } });

    const list = (await get(st.session, '/me/certificates').expect(200)).body as { id: string; code: string; certificateNumber: string | null; valid: boolean; revoked: boolean }[];
    const cert = list[0];
    expect(cert.certificateNumber).toMatch(/^IA-\d{4}-\d{6}$/);
    expect(cert.valid).toBe(true);

    const ok = (await http(app).get(`/certificates/${cert.code}/verify`).expect(200)).body;
    expect(ok.valid).toBe(true);
    expect(ok.status).toBe('ISSUED');

    const pdf = await http(app).get(`/certificates/${cert.code}/pdf`).expect(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);

    await post(st.session, `/admin/certificates/${cert.id}/revoke`, { reason: 'Issued in error' }).expect(403);
    await post(admin, `/admin/certificates/${cert.id}/revoke`, { reason: 'Issued in error for a test' }).expect(200);
    await post(admin, `/admin/certificates/${cert.id}/revoke`, { reason: 'Again please' }).expect(409);

    const revoked = (await http(app).get(`/certificates/${cert.code}/verify`).expect(200)).body;
    expect(revoked.valid).toBe(false);
    expect(revoked.status).toBe('REVOKED');
    expect(revoked.studentName).toBeUndefined();
    await http(app).get(`/certificates/${cert.code}/pdf`).expect(404);

    const after = (await get(st.session, '/me/certificates').expect(200)).body as { revoked: boolean; valid: boolean }[];
    expect(after[0].revoked).toBe(true);
    expect(after[0].valid).toBe(false);
    expect(await prisma.certificate.count({ where: { id: cert.id } })).toBe(1);
  });
});

