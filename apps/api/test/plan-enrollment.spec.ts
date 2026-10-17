import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { Session, apply, as, createOpenBatch, createPublishedCourse, createStudent, http, loginAdmin, verifyProof } from './helpers';
import { EntitlementService } from '../src/plans/entitlement.service';

/** Phase 5: plan selection flows through enrollment -> payment verification -> StudentPlan activation. */

let app: NestExpressApplication;
let prisma: PrismaClient;
let admin: Session;
let batchId: string;

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

describe('plan-based enrollment', () => {
  it('a STARTER application charges the plan price (not the course price), and verification activates STARTER', async () => {
    const plans = (await as(admin)(http(app).get('/admin/plans'))).body as Array<{ id: string; name: string; price: string }>;
    const starter = plans.find((p) => p.name === 'STARTER')!;

    const student = await createStudent(app, prisma);
    const res = await apply(app, student.session, batchId, { amount: Number(starter.price), applicant: { planName: 'STARTER' } as never }).expect(201);
    const enrollment = await prisma.enrollment.findUniqueOrThrow({ where: { id: res.body.enrollmentId }, include: { orderItem: { include: { order: true } } } });
    expect(Number(enrollment.orderItem!.order.total)).toBe(Number(starter.price));
    expect(enrollment.orderItem!.planName).toBe('STARTER');

    const proof = await prisma.paymentProof.findFirstOrThrow({ where: { payment: { orderId: enrollment.orderItem!.orderId } }, orderBy: { createdAt: 'desc' } });
    await verifyProof(app, admin, proof.id).expect(200);

    const service = app.get(EntitlementService);
    expect(await service.activePlanName(student.studentId)).toBe('STARTER');
    expect(await service.can(student.studentId, 'ai.evaluation')).toBe(false);
    expect(await service.can(student.studentId, 'practice.unlimited')).toBe(true);
  });

  it('a PREMIUM application (the default) still charges the live course price, unchanged from before plans existed', async () => {
    const student = await createStudent(app, prisma);
    const res = await apply(app, student.session, batchId, { amount: 10000 }).expect(201); // no planName -> defaults to PREMIUM
    const enrollment = await prisma.enrollment.findUniqueOrThrow({ where: { id: res.body.enrollmentId }, include: { orderItem: { include: { order: true } } } });
    expect(Number(enrollment.orderItem!.order.total)).toBe(10000);
    expect(enrollment.orderItem!.planName).toBe('PREMIUM');

    const proof = await prisma.paymentProof.findFirstOrThrow({ where: { payment: { orderId: enrollment.orderItem!.orderId } }, orderBy: { createdAt: 'desc' } });
    await verifyProof(app, admin, proof.id).expect(200);
    const service = app.get(EntitlementService);
    expect(await service.activePlanName(student.studentId)).toBe('PREMIUM');
    expect(await service.can(student.studentId, 'class.access')).toBe(true);
  });

  it('rejects applying for the FREE plan through the paid checkout flow', async () => {
    const student = await createStudent(app, prisma);
    await apply(app, student.session, batchId, { applicant: { planName: 'FREE' } as never }).expect(422);
  });

  it('a price-mismatch between claimedAmount and the plan price still flags, same as before', async () => {
    const student = await createStudent(app, prisma);
    const res = await apply(app, student.session, batchId, { amount: 1, applicant: { planName: 'PREMIUM' } as never }).expect(201);
    const enrollment = await prisma.enrollment.findUniqueOrThrow({ where: { id: res.body.enrollmentId }, include: { orderItem: true } });
    const proof = await prisma.paymentProof.findFirstOrThrow({ where: { payment: { orderId: enrollment.orderItem!.orderId } }, orderBy: { createdAt: 'desc' } });
    expect(proof.flags).toContain('AMOUNT_MISMATCH');
  });

  it('admin manual enrollment with an explicit plan activates that plan directly', async () => {
    const student = await createStudent(app, prisma);
    await as(admin)(http(app).post('/admin/enrollments')).send({ studentEmail: student.email, batchId, source: 'SCHOLARSHIP', reason: 'Scholarship grant', planName: 'ADVANCED' }).expect(201);
    const service = app.get(EntitlementService);
    expect(await service.activePlanName(student.studentId)).toBe('ADVANCED');
  });
});
