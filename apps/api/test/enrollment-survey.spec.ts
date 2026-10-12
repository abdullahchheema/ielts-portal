import type { NestExpressApplication } from '@nestjs/platform-express';
import * as argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { createOpenBatch, createStudent, enrollStudent, http, as, loginAdmin, login, PASSWORD, Session, uniq } from './helpers';

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

/** A teacher account with a mentor profile, optionally assigned to a batch. Mirrors mentor-analytics.spec.ts. */
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

const submitPayload = {
  takenBefore: 'YES', hadBand: 'YES', priorScores: { overall: 6, listening: 6.5, reading: 6, writing: 5.5, speaking: 6 },
  reason: 'UNIVERSITY_ADMISSION', targetBand: 7.5, testTimeline: 'ONE_TO_THREE_MONTHS', challengingSkills: ['WRITING', 'SPEAKING'],
  proficiency: 'INTERMEDIATE', dailyMinutes: 'SIXTY_TO_120', learningFormat: 'LIVE_CLASSES', helpWith: ['WRITING_FEEDBACK', 'STUDY_PLAN'],
};

describe('enrollment survey', () => {
  it('saves a draft one answer at a time and resumes it, rejecting a stale revision', async () => {
    const st = await createStudent(app, prisma);
    const empty = (await as(st.session)(http(app).get('/me/enrollment-survey')).expect(200)).body;
    expect(empty).toMatchObject({ status: 'DRAFT', revision: 0 });

    const r1 = (await as(st.session)(http(app).put('/me/enrollment-survey')).send({ revision: 0, answers: { takenBefore: 'NO' } }).expect(200)).body;
    expect(r1).toMatchObject({ revision: 1, takenBefore: 'NO' });

    const r2 = (await as(st.session)(http(app).put('/me/enrollment-survey')).send({ revision: 1, answers: { targetBand: 7 } }).expect(200)).body;
    expect(r2).toMatchObject({ revision: 2, takenBefore: 'NO', targetBand: 7 });

    const resumed = (await as(st.session)(http(app).get('/me/enrollment-survey')).expect(200)).body;
    expect(resumed).toMatchObject({ revision: 2, takenBefore: 'NO', targetBand: 7, status: 'DRAFT' });

    const stale = await as(st.session)(http(app).put('/me/enrollment-survey')).send({ revision: 1, answers: { targetBand: 8 } }).expect(409);
    expect(stale.body.error.code).toBe('ANSWER_SAVE_CONFLICT');
  });

  it('submit validates the full set, flips to SUBMITTED, and mirrors onto StudentProfile with TAKEN/NEVER translated from YES/NO', async () => {
    const st = await createStudent(app, prisma);
    await as(st.session)(http(app).post('/me/enrollment-survey/submit')).send(submitPayload).expect(201);

    const submitted = (await as(st.session)(http(app).get('/me/enrollment-survey')).expect(200)).body;
    expect(submitted).toMatchObject({ status: 'SUBMITTED', targetBand: 7.5, reason: 'UNIVERSITY_ADMISSION' });
    expect(submitted.submittedAt).toBeTruthy();

    const profile = await prisma.studentProfile.findUniqueOrThrow({ where: { id: st.studentId } });
    expect(profile.ieltsHistory).toBe('TAKEN');
    expect(Number(profile.targetBand)).toBe(7.5);
    expect(profile.preferredLearningMode).toBe('LIVE_CLASSES');
    expect(Number(profile.ieltsOverall)).toBe(6);
  });

  it('a submission that never had a prior band leaves ieltsHistory as NEVER and the score columns null', async () => {
    const st = await createStudent(app, prisma);
    await as(st.session)(http(app).post('/me/enrollment-survey/submit')).send({ ...submitPayload, takenBefore: 'NO', hadBand: undefined, priorScores: undefined }).expect(201);
    const profile = await prisma.studentProfile.findUniqueOrThrow({ where: { id: st.studentId } });
    expect(profile.ieltsHistory).toBe('NEVER');
    expect(profile.ieltsOverall).toBeNull();
  });

  it('rejects an incomplete submission', async () => {
    const st = await createStudent(app, prisma);
    await as(st.session)(http(app).post('/me/enrollment-survey/submit')).send({ takenBefore: 'NO' }).expect(422);
  });

  it('a student only ever sees their own survey, never another student\'s', async () => {
    const a = await createStudent(app, prisma);
    const b = await createStudent(app, prisma);
    await as(a.session)(http(app).post('/me/enrollment-survey/submit')).send(submitPayload).expect(201);
    const bView = (await as(b.session)(http(app).get('/me/enrollment-survey')).expect(200)).body;
    expect(bView).toMatchObject({ status: 'DRAFT', revision: 0 });
  });

  it('staff with student.view can read any student\'s survey', async () => {
    const st = await createStudent(app, prisma);
    await as(st.session)(http(app).post('/me/enrollment-survey/submit')).send(submitPayload).expect(201);
    const body = (await as(admin)(http(app).get(`/admin/students/${st.studentId}/enrollment-survey`)).expect(200)).body;
    expect(body).toMatchObject({ status: 'SUBMITTED', targetBand: 7.5 });
  });

  it('a teacher reaches a student\'s survey only through their own batch assignment', async () => {
    const batchId = await createOpenBatch(app, admin);
    const s = await enrollStudent(app, prisma, admin, batchId);
    await as(s.session)(http(app).post('/me/enrollment-survey/submit')).send(submitPayload).expect(201);

    const assigned = await teacher(batchId);
    const stranger = await teacher();
    const body = (await as(assigned)(http(app).get(`/mentor/students/${s.studentId}/enrollment-survey`)).expect(200)).body;
    expect(body).toMatchObject({ status: 'SUBMITTED', targetBand: 7.5 });
    // Same answer as a missing student: no way to probe for students outside the teacher's batches.
    await as(stranger)(http(app).get(`/mentor/students/${s.studentId}/enrollment-survey`)).expect(404);
  });
});
