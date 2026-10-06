import type { NestExpressApplication } from '@nestjs/platform-express';
import * as argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { PASSWORD, Session, as, createOpenBatch, enrollStudent, http, login, loginAdmin, uniq } from './helpers';

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

/** A teacher account with a mentor profile, optionally assigned to a batch. */
async function teacher(batchId?: string): Promise<Session> {
  const email = `mentor-${uniq()}@test.local`;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'MENTOR' } });
  const user = await prisma.user.create({
    data: {
      email, passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }), status: 'ACTIVE', emailVerifiedAt: new Date(),
      roles: { create: { roleId: role.id } },
      mentor: { create: { displayName: 'Test Teacher', specializations: [] } },
    },
    include: { mentor: true },
  });
  if (batchId) await prisma.batchMentor.create({ data: { batchId, mentorId: user.mentor!.id, mentorRole: 'MAIN' } });
  return login(app, email);
}

describe('teacher analytics respects batch assignment', () => {
  it('lets the assigned teacher see their batch, and refuses an unassigned teacher', async () => {
    const batchId = await createOpenBatch(app, admin);
    await enrollStudent(app, prisma, admin, batchId);
    const assigned = await teacher(batchId);
    const other = await teacher();
    const body = (await as(assigned)(http(app).get(`/mentor/batches/${batchId}/analytics`)).expect(200)).body;
    expect(body.summary.students).toBe(1);
    expect(body.items[0]).toHaveProperty('level');
    await as(other)(http(app).get(`/mentor/batches/${batchId}/analytics`)).expect(403);
  });

  it('shows a student only to a teacher in one of their batches, and only the teaching view', async () => {
    const batchId = await createOpenBatch(app, admin);
    const s = await enrollStudent(app, prisma, admin, batchId);
    const assigned = await teacher(batchId);
    const stranger = await teacher();
    const detail = (await as(assigned)(http(app).get(`/mentor/students/${s.studentId}/analytics`)).expect(200)).body;
    expect(detail.band).toHaveProperty('skills');
    expect(detail).not.toHaveProperty('orders');
    expect(detail).not.toHaveProperty('user');
    expect(JSON.stringify(detail)).not.toContain('@');
    // Same answer as a missing student: no way to probe for students in other batches.
    await as(stranger)(http(app).get(`/mentor/students/${s.studentId}/analytics`)).expect(404);
  });

  it('returns the audited correction history to the assigned teacher only', async () => {
    const batchId = await createOpenBatch(app, admin);
    const s = await enrollStudent(app, prisma, admin, batchId);
    const session = await prisma.liveSession.create({
      // Inside the attendance edit window (24 hours), so the teacher's own change is allowed and recorded.
      data: { batchId, topic: 'History check', startsAt: new Date(Date.now() - 2 * 3_600_000), endsAt: new Date(Date.now() - 2 * 3_600_000 + 3_600_000) },
    });
    const assigned = await teacher(batchId);
    const stranger = await teacher();
    await as(assigned)(http(app).put(`/mentor/sessions/${session.id}/attendance`)).send({ records: [{ studentId: s.studentId, status: 'PRESENT' }] }).expect(200);
    await as(assigned)(http(app).put(`/mentor/sessions/${session.id}/attendance`)).send({ records: [{ studentId: s.studentId, status: 'ABSENT', note: 'Travelling' }] }).expect(200);
    const history = (await as(assigned)(http(app).get(`/mentor/sessions/${session.id}/attendance/history`)).expect(200)).body;
    expect(history).toHaveLength(1);
    expect(history[0].before).toMatchObject({ status: 'PRESENT' });
    expect(history[0].after).toMatchObject({ status: 'ABSENT', note: 'Travelling' });
    await as(stranger)(http(app).get(`/mentor/sessions/${session.id}/attendance/history`)).expect(403);
  });
});
