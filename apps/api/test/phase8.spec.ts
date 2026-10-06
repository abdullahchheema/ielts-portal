import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { SettingsService } from '../src/settings/settings.service';
import { as, createOpenBatch, createStudent, enrollStudent, http, loginAdmin, Session, uniq } from './helpers';

/** Student lifecycle and the alumni area against the database. */

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

const get = (s: Session, path: string) => as(s)(http(app).get(path));
const post = (s: Session, path: string, body: object = {}) => as(s)(http(app).post(path)).send(body);

async function stageOf(studentId: string) {
  return (await prisma.studentLifecycle.findUnique({ where: { studentId }, select: { stage: true } }))?.stage ?? null;
}

/** Lifecycle signals are applied asynchronously after the request that caused them. */
async function waitForStage(studentId: string, stage: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if ((await stageOf(studentId)) === stage) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Stage did not reach ${stage}; it is ${await stageOf(studentId)}`);
}

describe('student lifecycle', () => {
  it('registration records the first stage, and staff moves are allowed only along the map', async () => {
    const st = await createStudent(app, prisma);
    await waitForStage(st.studentId, 'REGISTERED');

    const reason = `Applied by phone ${uniq()}`;
    await post(admin, `/admin/students/${st.studentId}/lifecycle`, { to: 'APPLICATION_SUBMITTED', reason }).expect(200);
    await post(admin, `/admin/students/${st.studentId}/lifecycle`, { to: 'APPLICATION_SUBMITTED', reason: 'Again please' }).expect(409);
    await post(admin, `/admin/students/${st.studentId}/lifecycle`, { to: 'ALUMNI', reason: 'Skipping ahead' }).expect(409);

    const tl = (await get(admin, `/admin/students/${st.studentId}/lifecycle`).expect(200)).body as {
      stage: string; transitions: { toStage: string; reason: string; source: string }[];
    };
    expect(tl.stage).toBe('APPLICATION_SUBMITTED');
    expect(tl.transitions[0]).toMatchObject({ toStage: 'APPLICATION_SUBMITTED', reason, source: 'STAFF' });
    expect(tl.transitions.some((t) => t.toStage === 'REGISTERED' && t.source === 'SYSTEM')).toBe(true);
  });

  it('a transition row cannot be edited or deleted', async () => {
    const st = await createStudent(app, prisma);
    await waitForStage(st.studentId, 'REGISTERED');
    const row = await prisma.studentLifecycleTransition.findFirstOrThrow({ where: { studentId: st.studentId } });
    await expect(prisma.studentLifecycleTransition.update({ where: { id: row.id }, data: { reason: 'Changed later' } })).rejects.toThrow();
    await expect(prisma.studentLifecycleTransition.delete({ where: { id: row.id } })).rejects.toThrow();
  });

  it('students cannot read or change lifecycle stages, including their own', async () => {
    const other = await createStudent(app, prisma);
    const me = await createStudent(app, prisma);
    await get(me.session, `/admin/students/${other.studentId}/lifecycle`).expect(403);
    await post(me.session, `/admin/students/${me.studentId}/lifecycle`, { to: 'ENROLLED', reason: 'Promote myself' }).expect(403);
    const own = (await get(me.session, '/me/lifecycle').expect(200)).body;
    expect(own.alumniAccess).toBe(false);
  });

  it('a student who has not completed the course cannot open the alumni area', async () => {
    const st = await createStudent(app, prisma);
    await get(st.session, '/alumni/home').expect(403);
  });

  it('completing the course and receiving a certificate makes the student an alumnus, and opens the alumni area', async () => {
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    await waitForStage(st.studentId, 'ENROLLED');

    await prisma.enrollment.update({ where: { id: st.enrollmentId }, data: { status: 'COMPLETED', completedAt: new Date() } });
    await post(admin, `/admin/students/${st.studentId}/lifecycle`, { to: 'COMPLETED', reason: 'Course finished (test)' }).expect(200);

    // Certificates are issued when first listed. Issuing one is what moves the student to alumni.
    const certs = (await get(st.session, '/me/certificates').expect(200)).body as { certificateNumber: string | null; valid: boolean }[];
    expect(certs).toHaveLength(1);
    expect(certs[0].certificateNumber).toMatch(/^IA-\d{4}-\d{6}$/);
    await waitForStage(st.studentId, 'ALUMNI');

    const me = (await get(st.session, '/me/lifecycle').expect(200)).body;
    expect(me).toMatchObject({ stage: 'ALUMNI', alumniAccess: true });

    const home = (await get(st.session, '/alumni/home').expect(200)).body as { certificates: { valid: boolean }[]; completedCourses: unknown[] };
    expect(home.certificates[0].valid).toBe(true);
    expect(home.completedCourses).toHaveLength(1);
  });

  it('switching the alumni area off closes it without changing anyone’s stage', async () => {
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    await waitForStage(st.studentId, 'ENROLLED');
    await prisma.enrollment.update({ where: { id: st.enrollmentId }, data: { status: 'COMPLETED', completedAt: new Date() } });
    await post(admin, `/admin/students/${st.studentId}/lifecycle`, { to: 'COMPLETED', reason: 'Course finished (test)' }).expect(200);
    await get(st.session, '/me/certificates').expect(200);
    await waitForStage(st.studentId, 'ALUMNI');

    const actor = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.local' }, select: { id: true } });
    const settings = app.get(SettingsService);
    try {
      await settings.update({ 'alumni.access': { enabled: false } }, { userId: actor.id });
      await get(st.session, '/alumni/home').expect(403);
      expect((await get(st.session, '/me/lifecycle').expect(200)).body.alumniAccess).toBe(false);
      expect(await stageOf(st.studentId)).toBe('ALUMNI');
    } finally {
      await settings.update({ 'alumni.access': { enabled: true } }, { userId: actor.id });
    }
    await get(st.session, '/alumni/home').expect(200);
  });
});
