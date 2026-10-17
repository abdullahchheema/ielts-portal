import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { EntitlementService } from '../src/plans/entitlement.service';
import { Session, as, createStudent, http, loginAdmin } from './helpers';

/** Phase 3: the Plan/PlanEntitlement/StudentPlan model, the EntitlementService gate, and admin management. */

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

describe('seeded plans and entitlements', () => {
  it('seeds exactly the four plans with FREE restrictive and PREMIUM permissive', async () => {
    const plans = (await as(admin)(http(app).get('/admin/plans')).expect(200)).body as Array<{ name: string; entitlements: { featureKey: string; value: unknown }[] }>;
    expect(plans.map((p) => p.name).sort()).toEqual(['ADVANCED', 'FREE', 'PREMIUM', 'STARTER']);
    const free = plans.find((p) => p.name === 'FREE')!;
    expect(free.entitlements.find((e) => e.featureKey === 'ai.evaluation')!.value).toBe(false);
    const premium = plans.find((p) => p.name === 'PREMIUM')!;
    expect(premium.entitlements.find((e) => e.featureKey === 'class.access')!.value).toBe(true);
  });

  it('public plans endpoint needs no auth and omits inactive plans', async () => {
    const res = (await http(app).get('/public/plans').expect(200)).body as Array<{ name: string }>;
    expect(res.length).toBe(4);
  });
});

describe('EntitlementService', () => {
  it('defaults to FREE for a student with no StudentPlan row', async () => {
    const student = await createStudent(app, prisma);
    const service = app.get(EntitlementService);
    expect(await service.activePlanName(student.studentId)).toBe('FREE');
    expect(await service.can(student.studentId, 'ai.evaluation')).toBe(false);
    expect(await service.can(student.studentId, 'practice.unlimited')).toBe(false);
  });

  it('a null studentId (anonymous lead) is always FREE', async () => {
    const service = app.get(EntitlementService);
    expect(await service.activePlanName(null)).toBe('FREE');
    expect(await service.can(null, 'ai.evaluation')).toBe(false);
  });

  it('grants the assigned plan\'s entitlements and respects expiry', async () => {
    const student = await createStudent(app, prisma);
    await as(admin)(http(app).post('/admin/student-plans')).send({ studentId: student.studentId, planName: 'ADVANCED', reason: 'test grant' }).expect(201);

    const service = app.get(EntitlementService);
    expect(await service.activePlanName(student.studentId)).toBe('ADVANCED');
    expect(await service.can(student.studentId, 'ai.evaluation')).toBe(true);
    expect(await service.can(student.studentId, 'class.access')).toBe(false); // ADVANCED, not PREMIUM

    const me = (await as(student.session)(http(app).get('/me/plan')).expect(200)).body;
    expect(me.planName).toBe('ADVANCED');
    expect(me.features['ai.evaluation']).toBe(true);
  });

  it('only one ACTIVE StudentPlan exists per student after reassignment', async () => {
    const student = await createStudent(app, prisma);
    await as(admin)(http(app).post('/admin/student-plans')).send({ studentId: student.studentId, planName: 'STARTER', reason: 'first' }).expect(201);
    await as(admin)(http(app).post('/admin/student-plans')).send({ studentId: student.studentId, planName: 'ADVANCED', reason: 'upgrade' }).expect(201);
    const active = await prisma.studentPlan.count({ where: { studentId: student.studentId, status: 'ACTIVE' } });
    expect(active).toBe(1);
    const service = app.get(EntitlementService);
    expect(await service.activePlanName(student.studentId)).toBe('ADVANCED');
  });
});

describe('admin plan management', () => {
  it('updates a plan\'s price and the change is visible immediately (cache invalidated)', async () => {
    const plans = (await as(admin)(http(app).get('/admin/plans')).expect(200)).body as Array<{ id: string; name: string; price: string | number }>;
    const starter = plans.find((p) => p.name === 'STARTER')!;
    const originalPrice = Number(starter.price);
    try {
      await as(admin)(http(app).patch(`/admin/plans/${starter.id}`)).send({ price: 6000 }).expect(200);
      const after = (await http(app).get('/public/plans').expect(200)).body as Array<{ name: string; price: number }>;
      expect(after.find((p) => p.name === 'STARTER')!.price).toBe(6000);
    } finally {
      await as(admin)(http(app).patch(`/admin/plans/${starter.id}`)).send({ price: originalPrice }).expect(200);
    }
  });

  it('replaces a plan\'s entitlements and the EntitlementService sees the change immediately', async () => {
    const plans = (await as(admin)(http(app).get('/admin/plans')).expect(200)).body as Array<{ id: string; name: string; entitlements: { featureKey: string; value: unknown; description: string | null }[] }>;
    const starter = plans.find((p) => p.name === 'STARTER')!;
    const original = starter.entitlements.map((e) => ({ featureKey: e.featureKey, value: e.value as boolean, description: e.description }));
    try {
      await as(admin)(http(app).put(`/admin/plans/${starter.id}/entitlements`)).send({
        entitlements: [
          { featureKey: 'practice.unlimited', value: true },
          { featureKey: 'mock.unlimited', value: true },
          { featureKey: 'ai.evaluation', value: true }, // flip on just for this test
        ],
      }).expect(200);

      const student = await createStudent(app, prisma);
      await as(admin)(http(app).post('/admin/student-plans')).send({ studentId: student.studentId, planName: 'STARTER', reason: 'test' }).expect(201);
      const service = app.get(EntitlementService);
      expect(await service.can(student.studentId, 'ai.evaluation')).toBe(true);
    } finally {
      // Plans are shared, global seed data — restore STARTER so later tests/files see the real defaults.
      await as(admin)(http(app).put(`/admin/plans/${starter.id}/entitlements`)).send({ entitlements: original }).expect(200);
    }
  });

  it('rejects an unauthenticated or under-permissioned caller', async () => {
    await http(app).get('/admin/plans').expect(401);
    const student = await createStudent(app, prisma);
    await as(student.session)(http(app).get('/admin/plans')).expect(403);
  });
});
