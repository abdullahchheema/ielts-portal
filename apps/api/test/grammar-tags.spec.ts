import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { as, createOpenBatch, enrollStudent, http, login, loginAdmin, PASSWORD, Session, uniq } from './helpers';

/** Teacher grammar tags: stored as TEACHER observations, and only for students in a batch the teacher may see. */

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

const tag = (s: Session, studentId: string, body: object) => as(s)(http(app).post(`/mentor/students/${studentId}/grammar-tags`)).send(body);

describe('teacher grammar tags', () => {
  it('an assigned teacher can tag a student in their batch, and the tag is stored as a teacher observation', async () => {
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    const t = await teacher(batchId);
    const res = await tag(t, st.studentId, { categoryCode: 'ARTICLES', excerpt: 'go to school', correction: 'go to the school' }).expect(201);
    const row = await prisma.grammarObservation.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.source).toBe('TEACHER');
    expect(row.writingEvaluationId).toBeNull();
    expect(row.excerpt).toBe('go to school');
  });

  it('a teacher with no link to the student’s batch gets not found, not a hint that the student exists', async () => {
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    const stranger = await teacher();
    await tag(stranger, st.studentId, { categoryCode: 'ARTICLES', excerpt: 'go to school' }).expect(404);
  });

  it('a student cannot tag grammar, and a category outside the list is refused', async () => {
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    await tag(st.session, st.studentId, { categoryCode: 'ARTICLES', excerpt: 'go to school' }).expect(403);
    const t = await teacher(batchId);
    await tag(t, st.studentId, { categoryCode: 'NOT_A_CATEGORY', excerpt: 'go to school' }).expect(422);
  });
});
