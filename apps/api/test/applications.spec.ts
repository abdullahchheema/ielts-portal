import type { NestExpressApplication } from '@nestjs/platform-express';
import * as argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import {
  PASSWORD, PNG, Session, apply, applyAs, as, createOpenBatch, createPublishedCourse, createStudent, daysFromNow, enrollStudent, http, login, loginAdmin,
  uniq, verifyProof,
} from './helpers';

let app: NestExpressApplication;
let prisma: PrismaClient;
let admin: Session;
let batchId: string;

const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 2)]); // Windows executable header

beforeAll(async () => {
  ({ app } = await createApp(false));
  await app.init();
  prisma = new PrismaClient();
  admin = await loginAdmin(app);
  await createPublishedCourse(app, admin, prisma, 10000);
  batchId = await createOpenBatch(app, admin);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function createStaff(roleName: string): Promise<Session> {
  const email = `${roleName.toLowerCase()}-${uniq()}@test.local`;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  await prisma.user.create({
    data: {
      email, passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }), status: 'ACTIVE', emailVerifiedAt: new Date(),
      roles: { create: { roleId: role.id } },
    },
  });
  return login(app, email);
}

const resubmit = (s: Session, enrollmentId: string, txn: string) =>
  as(s)(http(app).post(`/applications/${enrollmentId}/payment-proof`))
    .field('paymentMethod', 'EASYPAISA').field('transactionReference', txn).field('claimedAmount', '10000').field('transferDate', '2026-09-29')
    .attach('file', PNG, { filename: 'p.png', contentType: 'image/png' });

describe('public catalogue', () => {
  it('serves the one course and the open batches without logging in', async () => {
    const course = (await http(app).get('/public/course').expect(200)).body;
    expect(course.title).toBe('Complete IELTS Preparation');
    expect(course.modules.length).toBeGreaterThan(0);
    expect(course).not.toHaveProperty('slug');

    const draft = (await as(admin)(http(app).post('/admin/batches')).send({ name: 'Hidden draft', startAt: daysFromNow(9) }).expect(201)).body;
    const list = (await http(app).get('/public/batches').expect(200)).body as { id: string; mentorAssigned: boolean; mentors: unknown[] }[];
    expect(list.map((b) => b.id)).toContain(batchId);
    expect(list.map((b) => b.id)).not.toContain(draft.id);
    const ours = list.find((b) => b.id === batchId)!;
    expect(ours.mentorAssigned).toBe(false);
    expect(ours.mentors).toEqual([]);
    expect(list.every((b) => !('capacity' in b))).toBe(true);

    const methods = (await http(app).get('/public/payment-methods').expect(200)).body as { method: string }[];
    expect(methods.map((m) => m.method).sort()).toEqual(['BANK_TRANSFER', 'EASYPAISA', 'JAZZCASH']);
  });
});

describe('applying', () => {
  const profile = { phone: '0300-1234567', city: 'Lahore', country: 'Pakistan' };

  it('refuses anonymous visitors: an account has to exist and be verified before applying', async () => {
    await apply(app, null, batchId, { applicant: profile }).expect(401);
  });

  it('records the proof and the background details for a verified student, with no teacher assigned', async () => {
    const s = await createStudent(app, prisma);
    const res = await apply(app, s.session, batchId, { method: 'JAZZCASH', applicant: { ...profile, currentBand: '5.5', targetBand: '7', testType: 'ACADEMIC' } }).expect(201);
    expect(res.body).toEqual({ enrollmentId: expect.any(String), status: 'PENDING_PAYMENT_VERIFICATION' });

    const enrollment = await prisma.enrollment.findUniqueOrThrow({ where: { id: res.body.enrollmentId }, include: { student: { include: { user: true } }, orderItem: { include: { order: true } } } });
    expect(enrollment.status).toBe('PENDING_PAYMENT');
    expect(enrollment.batchId).toBe(batchId);
    expect(enrollment.studentId).toBe(s.studentId);
    expect(enrollment.student.city).toBe('Lahore');
    expect(enrollment.student.user.phone).toBe('0300-1234567');
    expect(enrollment.student.user.status).toBe('ACTIVE');
    expect(Number(enrollment.student.targetBand)).toBe(7);
    expect(Number(enrollment.orderItem!.order.total)).toBe(10000);
    const proof = await prisma.paymentProof.findFirstOrThrow({ where: { payment: { orderId: enrollment.orderItem!.orderId } } });
    expect(proof.paymentMethod).toBe('JAZZCASH');
    expect(proof.status).toBe('SUBMITTED');
    expect(await prisma.batchMentor.count({ where: { batchId } })).toBe(0);
  });

  it('accepts unlimited applicants for the same batch', async () => {
    const before = await prisma.enrollment.count({ where: { batchId } });
    const students = await Promise.all(Array.from({ length: 6 }, () => createStudent(app, prisma)));
    const results = await Promise.all(students.map((s) => apply(app, s.session, batchId, { applicant: profile })));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201]);
    expect(await prisma.enrollment.count({ where: { batchId } })).toBe(before + 6);
    expect((await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe('OPEN');
  }, 90_000);

  it('lets a signed-in student apply, and allows only one live application at a time (there is a single course)', async () => {
    const s = await createStudent(app, prisma);
    const other = await createOpenBatch(app, admin);
    await applyAs(app, prisma, s, batchId);
    for (const target of [batchId, other]) {
      const dup = await apply(app, s.session, target).expect(409);
      expect(dup.body.error.code).toBe('ENROLLMENT_ALREADY_EXISTS');
    }
    const mine = (await as(s.session)(http(app).get('/me/applications')).expect(200)).body as { status: string; displayStatus: string }[];
    expect(mine).toHaveLength(1);
    expect(mine[0].displayStatus).toBe('PENDING_PAYMENT_VERIFICATION');
  });

  it('validates the form before anything is written', async () => {
    const s = await createStudent(app, prisma);
    const noCity = await apply(app, s.session, batchId, { applicant: { ...profile, city: '' } }).expect(422);
    expect(noCity.body.error.details.city).toBeTruthy();
    const badMethod = await apply(app, s.session, batchId, { method: 'PAYPAL' }).expect(422);
    expect(badMethod.body.error.details.paymentMethod).toBeTruthy();
    expect(await prisma.enrollment.count({ where: { studentId: s.studentId } })).toBe(0);
  });

  it('refuses batches that are not open, and unknown batches', async () => {
    const s = await createStudent(app, prisma);
    const draft = (await as(admin)(http(app).post('/admin/batches')).send({ name: 'Draft batch', startAt: daysFromNow(1) }).expect(201)).body;
    expect((await apply(app, s.session, draft.id).expect(409)).body.error.code).toBe('BATCH_NOT_OPEN');
    await apply(app, s.session, '00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('rejects files whose bytes are not an allowed type, whatever the name/MIME claims', async () => {
    const s = await createStudent(app, prisma);
    const res = await apply(app, s.session, batchId, { file: EXE, filename: 'proof.png', contentType: 'image/png' }).expect(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('rejects oversized and missing files', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 10)]);
    const s = await createStudent(app, prisma);
    expect((await apply(app, s.session, batchId, { file: big }).expect(413)).body.error.code).toBe('FILE_TOO_LARGE');
    const none = await as(s.session)(http(app).post('/applications')).field('batchId', batchId).field('paymentMethod', 'BANK_TRANSFER').field('transactionReference', 'TXN12345')
      .field('claimedAmount', '10000').field('transferDate', '2026-09-28').field('phone', '0300-1234567').field('city', 'Lahore').field('country', 'Pakistan')
      .field('testType', 'ACADEMIC').field('targetBand', '7').field('examDate', '2027-06-01').field('ieltsHistory', 'NEVER');
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('PROOF_REQUIRED');
  });

  it('flags an amount that does not match the fee, and a reference already used elsewhere', async () => {
    const s = await createStudent(app, prisma);
    const t = await createStudent(app, prisma);
    const shared = `SHARED${uniq()}${uniq()}`;
    const a = await applyAs(app, prisma, s, batchId, { amount: 9000, txn: shared.toUpperCase() });
    const b = await applyAs(app, prisma, t, batchId, { txn: shared.toLowerCase() });
    expect((await prisma.paymentProof.findUniqueOrThrow({ where: { id: a.proofId } })).flags).toContain('AMOUNT_MISMATCH');
    expect((await prisma.paymentProof.findUniqueOrThrow({ where: { id: b.proofId } })).flags).toContain('DUPLICATE_TXN_REFERENCE');
  });

  it('gives a pending student no access to the course until payment is verified', async () => {
    const s = await createStudent(app, prisma);
    const a = await applyAs(app, prisma, s, batchId);
    const locked = await as(s.session)(http(app).get(`/me/courses/${a.enrollmentId}`)).expect(403);
    expect(locked.body.error.code).toBe('PAYMENT_PENDING');
    const dash = (await as(s.session)(http(app).get('/me/dashboard')).expect(200)).body;
    expect(dash.courses).toEqual([]);

    await verifyProof(app, admin, a.proofId).expect(200);
    await as(s.session)(http(app).get(`/me/courses/${a.enrollmentId}`)).expect(200);
  });
});

describe('admin verification', () => {
  it('lists applications by status with counts, a signed receipt URL and flags', async () => {
    const s = await createStudent(app, prisma);
    const a = await applyAs(app, prisma, s, batchId, { amount: 9000 });
    const pending = (await as(admin)(http(app).get('/admin/applications?status=PENDING&take=100')).expect(200)).body;
    const row = pending.items.find((r: { id: string }) => r.id === a.enrollmentId);
    expect(row.proof.fileUrl).toMatch(/^(https?:\/\/|\/api\/files\/)/);
    expect(row.proof.flags).toContain('AMOUNT_MISMATCH');
    expect(row.student.email).toBe(s.email);
    expect(pending.counts.pending).toBeGreaterThan(0);
    const enrolled = (await as(admin)(http(app).get('/admin/applications?status=ENROLLED&take=100')).expect(200)).body;
    expect(enrolled.items.find((r: { id: string }) => r.id === a.enrollmentId)).toBeUndefined();
  });

  it('only verifies with the right permission; verification enrols exactly once, even if two admins click together', async () => {
    const s = await createStudent(app, prisma);
    const a = await applyAs(app, prisma, s, batchId);

    const support = await createStaff('SUPPORT_AGENT');
    expect((await as(support)(http(app).post(`/admin/applications/proofs/${a.proofId}/verify`)).send({}).expect(403)).body.error.code).toBe('FORBIDDEN');
    await as(s.session)(http(app).post(`/admin/applications/proofs/${a.proofId}/verify`)).send({}).expect(403);
    await as(s.session)(http(app).get('/admin/applications')).expect(403);

    const finance = await createStaff('FINANCE_ADMIN');
    const [r1, r2] = await Promise.all([verifyProof(app, finance, a.proofId), verifyProof(app, admin, a.proofId)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect([r1, r2].find((r) => r.status === 409)!.body.error.code).toBe('ORDER_ALREADY_PAID');

    const e = await prisma.enrollment.findUniqueOrThrow({ where: { id: a.enrollmentId } });
    expect(e.status).toBe('ACTIVE');
    expect(e.enrolledAt).toBeTruthy();
    expect(e.accessEndsAt!.getTime()).toBeGreaterThan(Date.now());
    expect((await prisma.order.findUniqueOrThrow({ where: { id: a.orderId } })).status).toBe('PAID');
    expect(await prisma.enrollment.count({ where: { studentId: s.studentId, batchId } })).toBe(1);
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: a.orderId } });
    expect(await prisma.auditLog.count({ where: { action: 'ADMIN_VERIFIED_PAYMENT', entityId: payment.id } })).toBe(1);

    const enrolled = (await as(admin)(http(app).get('/admin/applications?status=ENROLLED&take=100')).expect(200)).body;
    expect(enrolled.items.map((r: { id: string }) => r.id)).toContain(a.enrollmentId);
  }, 90_000);

  it('requires explicit confirmation to verify a mismatched amount', async () => {
    const s = await createStudent(app, prisma);
    const a = await applyAs(app, prisma, s, batchId, { amount: 9000 });
    expect((await verifyProof(app, admin, a.proofId).expect(409)).body.error.code).toBe('PAYMENT_AMOUNT_MISMATCH');
    await verifyProof(app, admin, a.proofId, { confirmAmountMismatch: true }).expect(200);
  });

  it('refuses the same reference number on two applications once one is verified, leaving nothing half-done', async () => {
    const a = await createStudent(app, prisma);
    const b = await createStudent(app, prisma);
    const shared = `DUP${uniq()}${uniq()}`;
    const pa = await applyAs(app, prisma, a, batchId, { txn: shared });
    const pb = await applyAs(app, prisma, b, batchId, { txn: shared });
    await verifyProof(app, admin, pa.proofId).expect(200);
    expect((await verifyProof(app, admin, pb.proofId).expect(409)).body.error.code).toBe('DUPLICATE_PAYMENT_PROOF');
    expect((await prisma.enrollment.findUniqueOrThrow({ where: { id: pb.enrollmentId } })).status).toBe('PENDING_PAYMENT');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: pb.orderId } })).status).toBe('PENDING_REVIEW');
  });

  it('reject + resubmit keeps the application open; a final rejection closes it', async () => {
    const s = await createStudent(app, prisma);
    const a = await applyAs(app, prisma, s, batchId);
    await as(admin)(http(app).post(`/admin/applications/proofs/${a.proofId}/reject`)).send({ reason: 'Blurry screenshot', allowResubmit: true }).expect(200);

    const open = (await as(s.session)(http(app).get('/me/applications')).expect(200)).body[0];
    expect(open.status).toBe('PENDING_PAYMENT');
    expect(open.canResubmit).toBe(true);
    expect(open.payment.rejectionReason).toBe('Blurry screenshot');

    const stranger = await createStudent(app, prisma);
    await resubmit(stranger.session, a.enrollmentId, 'X12345').expect(404);

    await resubmit(s.session, a.enrollmentId, `RE${uniq()}${uniq()}`).expect(201);
    const again = await resubmit(s.session, a.enrollmentId, 'Y12345');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PAYMENT_PENDING');

    const latest = await prisma.paymentProof.findFirstOrThrow({ where: { payment: { orderId: a.orderId }, status: 'SUBMITTED' } });
    await as(admin)(http(app).post(`/admin/applications/proofs/${latest.id}/reject`)).send({ reason: 'Payment never arrived', allowResubmit: false }).expect(200);
    const closed = (await as(s.session)(http(app).get('/me/applications')).expect(200)).body[0];
    expect(closed.status).toBe('REJECTED');
    expect(closed.canResubmit).toBe(false);
    const rejected = (await as(admin)(http(app).get('/admin/applications?status=REJECTED&take=100')).expect(200)).body;
    expect(rejected.items.map((r: { id: string }) => r.id)).toContain(a.enrollmentId);
    await as(s.session)(http(app).get(`/me/courses/${a.enrollmentId}`)).expect(403);
  }, 90_000);

  it('lets a rejected student apply again to the same batch', async () => {
    const s = await createStudent(app, prisma);
    const a = await applyAs(app, prisma, s, batchId);
    await as(admin)(http(app).post(`/admin/applications/proofs/${a.proofId}/reject`)).send({ reason: 'Wrong account', allowResubmit: false }).expect(200);
    await applyAs(app, prisma, s, batchId);
  });
});

describe('coupons', () => {
  const mkCoupon = async (over: Record<string, unknown> = {}) => {
    const code = `T${uniq()}`.toUpperCase();
    await as(admin)(http(app).post('/admin/coupons')).send({ code, discountType: 'PERCENTAGE', value: 20, ...over }).expect(201);
    return code;
  };
  const total = async (orderId: string) => Number((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).total);

  it('applies percentage and fixed discounts server-side', async () => {
    const s1 = await createStudent(app, prisma);
    const s2 = await createStudent(app, prisma);
    const a = await applyAs(app, prisma, s1, batchId, { coupon: await mkCoupon({ discountType: 'PERCENTAGE', value: 20 }), amount: 8000 });
    const b = await applyAs(app, prisma, s2, batchId, { coupon: await mkCoupon({ discountType: 'FIXED', value: 1500 }), amount: 8500 });
    expect(await total(a.orderId)).toBe(8000);
    expect(await total(b.orderId)).toBe(8500);
  });

  it('never hands out the last redemption twice, and a failed coupon leaves no application behind', async () => {
    const code = await mkCoupon({ maxRedemptions: 1 });
    const students = await Promise.all(Array.from({ length: 4 }, () => createStudent(app, prisma)));
    const results = await Promise.all(students.map((s) => apply(app, s.session, batchId, { coupon: code, amount: 8000 })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of results.filter((r) => r.status !== 201)) expect(r.body.error.code).toBe('COUPON_INVALID');
    expect((await prisma.coupon.findUniqueOrThrow({ where: { code } })).redeemedCount).toBe(1);
    const losers = students.filter((_, i) => results[i].status !== 201);
    expect(await prisma.enrollment.count({ where: { studentId: { in: losers.map((l) => l.studentId) } } })).toBe(0);
  }, 90_000);

  it('returns the redemption when an application is finally rejected', async () => {
    const code = await mkCoupon({ maxRedemptions: 1 });
    const a = await createStudent(app, prisma);
    const b = await createStudent(app, prisma);
    const pa = await applyAs(app, prisma, a, batchId, { coupon: code, amount: 8000 });
    expect((await apply(app, b.session, batchId, { coupon: code, amount: 8000 }).expect(422)).body.error.code).toBe('COUPON_INVALID');
    await as(admin)(http(app).post(`/admin/applications/proofs/${pa.proofId}/reject`)).send({ reason: 'Fake receipt', allowResubmit: false }).expect(200);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { code } })).redeemedCount).toBe(0);
    await applyAs(app, prisma, b, batchId, { coupon: code, amount: 8000 });
  }, 90_000);

  it('enforces expiry and unknown codes, and only staff can create coupons', async () => {
    const s = await createStudent(app, prisma);
    const expired = await mkCoupon({ startsAt: '2020-01-01T00:00:00Z', expiresAt: '2020-02-01T00:00:00Z' });
    expect((await apply(app, s.session, batchId, { coupon: expired }).expect(422)).body.error.code).toBe('COUPON_INVALID');
    expect((await apply(app, s.session, batchId, { coupon: 'NOPE_NOT_REAL' }).expect(422)).body.error.code).toBe('COUPON_INVALID');
    await as(s.session)(http(app).post('/admin/coupons')).send({ code: 'HACK', discountType: 'PERCENTAGE', value: 99 }).expect(403);
  });
});

describe('manual enrollment', () => {
  it('enrolls by email with a source and blocks duplicates', async () => {
    const a = await createStudent(app, prisma);
    const b = await createOpenBatch(app, admin);
    const res = await as(admin)(http(app).post('/admin/enrollments')).send({ studentEmail: a.email, batchId: b, source: 'SCHOLARSHIP', reason: 'Merit scholarship' }).expect(201);
    expect(res.body.source).toBe('SCHOLARSHIP');
    expect(res.body.status).toBe('ACTIVE');
    const dup = await as(admin)(http(app).post('/admin/enrollments')).send({ studentEmail: a.email, batchId: b, source: 'ADMIN', reason: 'again' }).expect(409);
    expect(dup.body.error.code).toBe('ENROLLMENT_ALREADY_EXISTS');
    expect(await prisma.auditLog.count({ where: { action: 'ADMIN_CREATED_ENROLLMENT', entityId: res.body.id } })).toBe(1);
  });

  it('points the admin at verification when the student already has a pending application', async () => {
    const s = await createStudent(app, prisma);
    await applyAs(app, prisma, s, batchId);
    const res = await as(admin)(http(app).post('/admin/enrollments')).send({ studentId: s.studentId, batchId, source: 'CORPORATE', reason: 'Paid by employer' }).expect(409);
    expect(res.body.error.code).toBe('ENROLLMENT_ALREADY_EXISTS');
    expect(res.body.error.message).toMatch(/verify/i);
  });
});

it('enrollStudent helper produces an ACTIVE enrollment', async () => {
  const e = await enrollStudent(app, prisma, admin, batchId);
  expect((await prisma.enrollment.findUniqueOrThrow({ where: { id: e.enrollmentId } })).status).toBe('ACTIVE');
});
