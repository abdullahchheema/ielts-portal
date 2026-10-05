import type { NestExpressApplication } from '@nestjs/platform-express';
import * as argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { PASSWORD, Session, applyAs, as, createOpenBatch, createPublishedCourse, createStudent, http, login, loginAdmin, uniq, verifyProof } from './helpers';

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

const post = (path: string, body: object = {}) => as(admin)(http(app).post(path)).send(body);
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

async function staff(roleName: string) {
  const email = `${roleName.toLowerCase()}-${uniq()}@test.local`;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const user = await prisma.user.create({ data: { email, passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }), status: 'ACTIVE', emailVerifiedAt: new Date(), roles: { create: { roleId: role.id } } } });
  return { id: user.id, email, session: await login(app, email) };
}
async function mentor(batchId: string | null) {
  const email = `mentor-${uniq()}@test.local`;
  const m = (await post('/admin/mentors', { email, displayName: 'Mentor ' + uniq(), password: PASSWORD }).expect(201)).body;
  if (batchId) await post(`/admin/batches/${batchId}/mentors`, { mentorId: m.id, mentorRole: 'MAIN' }).expect(201);
  return { session: await login(app, email) };
}

/** Full flow: application -> admin verification. Returns the paid order/payment/enrollment. */
async function buy(batchId: string, price: number) {
  const st = await createStudent(app, prisma);
  const a = await applyAs(app, prisma, st, batchId, { amount: price });
  await verifyProof(app, admin, a.proofId).expect(200);
  const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: a.orderId } });
  return { st, orderId: a.orderId, paymentId: payment.id, enrollmentId: a.enrollmentId };
}

describe('refunds', () => {
  it('lets a student request, finance pay out, and ends access on a full refund', async () => {
    const c = await createPublishedCourse(app, admin, prisma, 10000);
    const batchId = await createOpenBatch(app, admin);
    const { st, orderId, paymentId, enrollmentId } = await buy(batchId, 10000);
    await as(st.session)(http(app).get(`/content/${c.itemId}`)).expect(200);

    // Others: unpaid orders, strangers and non-finance staff are refused.
    const stranger = await createStudent(app, prisma);
    await as(stranger.session)(http(app).post(`/orders/${orderId}/refund-request`)).send({ reason: 'not mine to ask' }).expect(404);
    const support = await staff('SUPPORT_AGENT');
    await as(support.session)(http(app).get('/admin/refunds')).expect(403);
    expect((await as(st.session)(http(app).post(`/orders/${orderId}/refund-request`)).send({ reason: 'no' }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');

    const req = (await as(st.session)(http(app).post(`/orders/${orderId}/refund-request`)).send({ reason: 'Changed my plans, sorry.' }).expect(201)).body;
    expect(Number(req.amount)).toBe(10000);
    expect((await as(st.session)(http(app).post(`/orders/${orderId}/refund-request`)).send({ reason: 'again please' }).expect(409)).body.error.code).toBe('REFUND_NOT_ALLOWED');

    const rival = await createStudent(app, prisma);

    const finance = await staff('FINANCE_ADMIN');
    const queue = (await as(finance.session)(http(app).get('/admin/refunds?status=REQUESTED')).expect(200)).body as { id: string }[];
    expect(queue.map((r) => r.id)).toContain(req.id);
    await as(finance.session)(http(app).post(`/admin/refunds/${req.id}/process`)).send({}).expect(422); // needs the bank reference
    const [a, b] = await Promise.all([
      as(finance.session)(http(app).post(`/admin/refunds/${req.id}/process`)).send({ providerReference: 'PAYOUT-123456' }),
      as(admin)(http(app).post(`/admin/refunds/${req.id}/process`)).send({ providerReference: 'PAYOUT-123456' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]); // processed exactly once

    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('REFUNDED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('REFUNDED');
    expect((await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).status).toBe('REFUNDED');
    expect((await as(st.session)(http(app).get(`/content/${c.itemId}`)).expect(403)).body.error.code).toBe('ACCESS_DENIED');
    await applyAs(app, prisma, rival, batchId); // a refund never blocks anyone else
    expect(await prisma.auditLog.count({ where: { action: 'ADMIN_ISSUED_REFUND', entityId: req.id } })).toBe(1);
    // Financial rows cannot be deleted.
    await expect(prisma.$executeRawUnsafe(`DELETE FROM refunds WHERE id = '${req.id}'::uuid`)).rejects.toThrow();
  }, 180_000);

  it('supports partial refunds, refuses over-refunds, honours the window, and can reject', async () => {
    const c = await createPublishedCourse(app, admin, prisma, 10000);
    const batchId = await createOpenBatch(app, admin);
    const { st, orderId, paymentId, enrollmentId } = await buy(batchId, 10000);

    const over = await post(`/admin/payments/${paymentId}/refunds`, { amount: 10001, reason: 'too much' }).expect(409);
    expect(over.body.error.code).toBe('REFUND_NOT_ALLOWED');
    const partial = (await post(`/admin/payments/${paymentId}/refunds`, { amount: 3000, reason: 'Goodwill' }).expect(201)).body;
    await post(`/admin/refunds/${partial.id}/process`, { providerReference: 'PAYOUT-PARTIAL' }).expect(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('PARTIALLY_REFUNDED');
    expect((await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).status).toBe('ACTIVE'); // partial keeps access
    expect((await post(`/admin/payments/${paymentId}/refunds`, { amount: 7001, reason: 'over remaining' }).expect(409)).body.error.code).toBe('REFUND_NOT_ALLOWED');

    // Student request after the window is refused; a rejected request stays on record.
    await prisma.payment.update({ where: { id: paymentId }, data: { paidAt: new Date(Date.now() - 30 * 86_400_000) } });
    expect((await as(st.session)(http(app).post(`/orders/${orderId}/refund-request`)).send({ reason: 'Too late but trying' }).expect(409)).body.error.code).toBe('REFUND_NOT_ALLOWED');
    const other = (await post(`/admin/payments/${paymentId}/refunds`, { amount: 1000, reason: 'Second' }).expect(201)).body;
    await post(`/admin/refunds/${other.id}/reject`, { note: 'Not eligible' }).expect(200);
    expect((await post(`/admin/refunds/${other.id}/process`, { providerReference: 'X-REF-1' }).expect(409)).body.error.code).toBe('REFUND_NOT_ALLOWED');
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: other.id } })).status).toBe('REJECTED');
  }, 180_000);
});

describe('live classes & attendance', () => {
  it('scopes sessions to assigned mentors, hides join links until close to start, and tracks attendance', async () => {
    const c = await createPublishedCourse(app, admin, prisma);
    const batchId = await createOpenBatch(app, admin);
    const main = await mentor(batchId);
    const outsider = await mentor(null);
    const st = await createStudent(app, prisma);
    await post('/admin/enrollments', { studentId: st.studentId, batchId, source: 'ADMIN', reason: 'test' }).expect(201);
    const notEnrolled = await createStudent(app, prisma);

    const body = (over: object) => ({ topic: 'Writing Task 2', startsAt: inMs(2 * 86_400_000), endsAt: inMs(2 * 86_400_000 + 3_600_000), provider: 'ZOOM', meetingUrl: 'https://zoom.us/j/123', ...over });
    await as(outsider.session)(http(app).post(`/mentor/batches/${batchId}/sessions`)).send(body({})).expect(403);
    expect((await as(main.session)(http(app).post(`/mentor/batches/${batchId}/sessions`)).send(body({ endsAt: inMs(1000) })).expect(422)).body.error.details.endsAt).toBeTruthy();
    expect((await as(main.session)(http(app).post(`/mentor/batches/${batchId}/sessions`)).send(body({ meetingUrl: 'http://insecure.example' })).expect(422)).body.error.code).toBe('VALIDATION_ERROR');

    const later = (await as(main.session)(http(app).post(`/mentor/batches/${batchId}/sessions`)).send(body({})).expect(201)).body;
    const soon = (await as(main.session)(http(app).post(`/mentor/batches/${batchId}/sessions`)).send(body({ topic: 'Starting soon', startsAt: inMs(5 * 60_000), endsAt: inMs(65 * 60_000) })).expect(201)).body;
    expect(await prisma.notification.count({ where: { userId: st.userId, type: 'SESSION_SCHEDULED' } })).toBe(2);

    const mine = (await as(st.session)(http(app).get('/me/sessions')).expect(200)).body;
    const find = (id: string) => mine.upcoming.find((s: { id: string }) => s.id === id);
    expect(find(later.id).joinUrl).toBeNull(); // two days out
    expect(find(soon.id).joinUrl).toBe('https://zoom.us/j/123'); // inside the 15-minute window
    expect((await as(notEnrolled.session)(http(app).get('/me/sessions')).expect(200)).body.upcoming).toEqual([]);

    // Past sessions + attendance percentage.
    const mk = async (topic: string) => (await as(main.session)(http(app).post(`/mentor/batches/${batchId}/sessions`)).send(body({ topic, startsAt: inMs(-3 * 3_600_000), endsAt: inMs(-2 * 3_600_000) })).expect(201)).body.id as string;
    const [p1, p2] = [await mk('Past 1'), await mk('Past 2')];
    const sheet = (await as(main.session)(http(app).get(`/mentor/sessions/${p1}/attendance`)).expect(200)).body;
    expect(sheet.roster.map((r: { studentId: string }) => r.studentId)).toEqual([st.studentId]);
    expect((await as(main.session)(http(app).put(`/mentor/sessions/${p1}/attendance`)).send({ records: [{ studentId: notEnrolled.studentId, status: 'PRESENT' }] }).expect(422)).body.error.details.records).toBeTruthy();
    await as(outsider.session)(http(app).put(`/mentor/sessions/${p1}/attendance`)).send({ records: [{ studentId: st.studentId, status: 'PRESENT' }] }).expect(403);
    await as(main.session)(http(app).put(`/mentor/sessions/${p1}/attendance`)).send({ records: [{ studentId: st.studentId, status: 'PRESENT', minutesAttended: 58 }] }).expect(200);
    await as(main.session)(http(app).put(`/mentor/sessions/${p2}/attendance`)).send({ records: [{ studentId: st.studentId, status: 'ABSENT' }] }).expect(200);
    await as(main.session)(http(app).put(`/mentor/sessions/${p2}/attendance`)).send({ records: [{ studentId: st.studentId, status: 'EXCUSED' }] }).expect(200); // correction, no duplicate
    expect(await prisma.attendance.count({ where: { sessionId: p2 } })).toBe(1);

    // The student must have been enrolled before these classes ran; a session held before joining does not count against them.
    await prisma.enrollment.updateMany({ where: { studentId: st.studentId }, data: { enrolledAt: new Date(Date.now() - 5 * 86_400_000), accessStartsAt: new Date(Date.now() - 5 * 86_400_000) } });
    const summary = (await as(st.session)(http(app).get('/me/attendance')).expect(200)).body[0];
    // An excused absence leaves the denominator: 1 attended out of 1 non-excused session.
    expect(summary).toMatchObject({ sessionsHeld: 2, present: 1, excused: 1, attendancePercent: 100 });

    expect((await as(main.session)(http(app).delete(`/mentor/sessions/${p1}`)).expect(409)).body.error.code).toBe('CONFLICT');
    await as(main.session)(http(app).delete(`/mentor/sessions/${later.id}`)).expect(204);
    await as(main.session)(http(app).patch(`/mentor/sessions/${p1}`)).send({ recordingUrl: 'https://example.com/rec' }).expect(200);
    expect((await as(st.session)(http(app).get('/me/sessions')).expect(200)).body.past.find((s: { id: string }) => s.id === p1).recordingUrl).toBe('https://example.com/rec');
  }, 180_000);
});

describe('support tickets', () => {
  it('runs a conversation with internal notes hidden from the student', async () => {
    const st = await createStudent(app, prisma);
    const other = await createStudent(app, prisma);
    const agent = await staff('SUPPORT_AGENT');
    const finance = await staff('FINANCE_ADMIN');

    const t = (await as(st.session)(http(app).post('/me/tickets')).send({ category: 'PAYMENT', subject: 'Receipt not accepted', description: 'I uploaded my receipt yesterday.' }).expect(201)).body;
    await as(other.session)(http(app).get(`/me/tickets/${t.id}`)).expect(404);
    await as(finance.session)(http(app).get('/admin/tickets')).expect(403);
    await as(st.session)(http(app).get('/admin/tickets')).expect(403);

    const list = (await as(agent.session)(http(app).get('/admin/tickets?status=OPEN')).expect(200)).body;
    expect(list.items.map((i: { id: string }) => i.id)).toContain(t.id);
    await as(agent.session)(http(app).post(`/admin/tickets/${t.id}/messages`)).send({ body: 'Checking with finance', internal: true }).expect(200);
    await as(agent.session)(http(app).post(`/admin/tickets/${t.id}/messages`)).send({ body: 'Could you resend the receipt?' }).expect(200);
    expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('WAITING_FOR_STUDENT');
    expect(await prisma.notification.count({ where: { userId: st.userId, type: 'TICKET_REPLY' } })).toBe(1); // internal note did not notify

    const seen = (await as(st.session)(http(app).get(`/me/tickets/${t.id}`)).expect(200)).body;
    expect(seen.messages.map((m: { body: string }) => m.body)).toEqual(['Could you resend the receipt?']);
    const staffView = (await as(agent.session)(http(app).get(`/admin/tickets/${t.id}`)).expect(200)).body;
    expect(staffView.messages).toHaveLength(2);
    expect(staffView.user.student.enrollments).toEqual([]); // limited enrolment context only

    await as(st.session)(http(app).post(`/me/tickets/${t.id}/messages`)).send({ body: 'Here it is again.' }).expect(200);
    expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('OPEN');
    await as(agent.session)(http(app).patch(`/admin/tickets/${t.id}`)).send({ status: 'RESOLVED', assignedTo: agent.id }).expect(200);
    expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id: t.id } })).resolvedAt).toBeTruthy();
    await as(agent.session)(http(app).patch(`/admin/tickets/${t.id}`)).send({ status: 'CLOSED' }).expect(200);
    expect((await as(st.session)(http(app).post(`/me/tickets/${t.id}/messages`)).send({ body: 'one more thing' }).expect(409)).body.error.code).toBe('CONFLICT');
    expect(await prisma.auditLog.count({ where: { action: 'TICKET_UPDATED', entityId: t.id } })).toBe(2);
  }, 120_000);
});

describe('reports', () => {
  it('shows each role only its own figures and reflects real purchases and refunds', async () => {
    const c = await createPublishedCourse(app, admin, prisma, 12345);
    const batchId = await createOpenBatch(app, admin);
    const { paymentId } = await buy(batchId, 12345);
    await post(`/admin/payments/${paymentId}/refunds`, { amount: 345, reason: 'Adjustment' }).then(async (r) => post(`/admin/refunds/${r.body.id}/process`, { providerReference: 'ADJ-0001' }).expect(200));

    const today = new Date().toISOString().slice(0, 10);
    const full = (await as(admin)(http(app).get(`/admin/reports/overview?from=${today}&to=${today}`)).expect(200)).body;
    expect(full.finance.revenue).toBeGreaterThanOrEqual(12345);
    expect(full.finance.refunded).toBeGreaterThanOrEqual(345);
    expect(full.finance.byCourse.find((r: { course: string }) => r.course === 'Complete IELTS Preparation')).toBeTruthy();
    expect(full.finance.daily.at(-1).day).toBe(today);
    expect(full.academic.enrollments.active).toBeGreaterThan(0);
    expect(full.academic.registrationToPurchasePercent).not.toBeUndefined();

    const finance = await staff('FINANCE_ADMIN');
    const f = (await as(finance.session)(http(app).get('/admin/reports/overview')).expect(200)).body;
    expect(f.finance).toBeTruthy();
    expect(f.academic).toBeNull();
    const support = await staff('SUPPORT_AGENT');
    const s = (await as(support.session)(http(app).get('/admin/reports/overview')).expect(200)).body;
    expect(s.finance).toBeNull();
    expect(s.academic).toBeNull();

    const student = await createStudent(app, prisma);
    await as(student.session)(http(app).get('/admin/reports/overview')).expect(403);
    await as(admin)(http(app).get('/admin/reports/overview?from=not-a-date')).expect(422);
  }, 180_000);
});
