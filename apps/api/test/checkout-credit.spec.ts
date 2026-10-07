import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { apply, as, createOpenBatch, createStudent, http, loginAdmin, mainCourse, Session, verifyProof } from './helpers';

/** Account credit at checkout: it reduces the order, is recorded in the ledger, and never makes an order free. */

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

async function orderFor(enrollmentId: string) {
  const e = await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollmentId }, include: { orderItem: { include: { order: true } } } });
  return e.orderItem!.order;
}

describe('checkout credit', () => {
  it('spends credit on the order, and records the spend in the ledger', async () => {
    const course = await mainCourse(app, admin);
    const price = Number(course.price);
    const batchId = await createOpenBatch(app, admin);
    const st = await createStudent(app, prisma);
    await prisma.accountCreditLedger.create({ data: { studentId: st.studentId, type: 'ADJUSTMENT', amount: 500, reason: 'Test credit' } });

    const res = await apply(app, st.session, batchId, { amount: price - 500, credit: true }).expect(201);
    const order = await orderFor(res.body.enrollmentId);
    expect(Number(order.creditApplied)).toBe(500);
    expect(Number(order.total)).toBe(price - 500);

    const spend = await prisma.accountCreditLedger.findFirstOrThrow({ where: { studentId: st.studentId, type: 'REDEMPTION' } });
    expect(Number(spend.amount)).toBe(-500);
    expect(spend.reason).toContain(order.reference);
  });

  it('credit never makes an order free: at least one unit stays payable', async () => {
    const course = await mainCourse(app, admin);
    const price = Number(course.price);
    const batchId = await createOpenBatch(app, admin);
    const st = await createStudent(app, prisma);
    await prisma.accountCreditLedger.create({ data: { studentId: st.studentId, type: 'ADJUSTMENT', amount: price * 10, reason: 'Test credit' } });

    const res = await apply(app, st.session, batchId, { amount: 1, credit: true }).expect(201);
    const order = await orderFor(res.body.enrollmentId);
    expect(Number(order.total)).toBe(1);
    expect(Number(order.creditApplied)).toBe(price - 1);
  });

  it('without the opt-in, the balance is untouched', async () => {
    const course = await mainCourse(app, admin);
    const price = Number(course.price);
    const batchId = await createOpenBatch(app, admin);
    const st = await createStudent(app, prisma);
    await prisma.accountCreditLedger.create({ data: { studentId: st.studentId, type: 'ADJUSTMENT', amount: 500, reason: 'Test credit' } });

    const res = await apply(app, st.session, batchId, { amount: price }).expect(201);
    const order = await orderFor(res.body.enrollmentId);
    expect(Number(order.creditApplied)).toBe(0);
    expect(await prisma.accountCreditLedger.count({ where: { studentId: st.studentId, type: 'REDEMPTION' } })).toBe(0);
  });

  it('a full refund returns the credit spent on the order to the balance', async () => {
    const price = Number((await mainCourse(app, admin)).price);
    const batchId = await createOpenBatch(app, admin);
    const st = await createStudent(app, prisma);
    await prisma.accountCreditLedger.create({ data: { studentId: st.studentId, type: 'ADJUSTMENT', amount: 500, reason: 'Test credit' } });

    const res = await apply(app, st.session, batchId, { amount: price - 500, credit: true }).expect(201);
    const order = await orderFor(res.body.enrollmentId);
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    const proof = await prisma.paymentProof.findFirstOrThrow({ where: { paymentId: payment.id }, orderBy: { createdAt: 'desc' } });
    await verifyProof(app, admin, proof.id).expect(200);

    const refund = (await as(admin)(http(app).post(`/admin/payments/${payment.id}/refunds`))
      .send({ amount: Number(payment.amount), reason: 'Student withdrew (test)' }).expect(201)).body;
    await as(admin)(http(app).post(`/admin/refunds/${refund.id}/process`)).send({ providerReference: 'TEST-PAYOUT-001' }).expect(200);

    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('REFUNDED');
    const back = await prisma.accountCreditLedger.findFirstOrThrow({ where: { studentId: st.studentId, type: 'ADJUSTMENT', reason: { contains: 'Credit returned' } } });
    expect(Number(back.amount)).toBe(500);
  });
});
