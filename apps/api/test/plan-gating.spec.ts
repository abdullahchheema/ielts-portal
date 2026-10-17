import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { Session, as, createOpenBatch, enrollStudent, http, createStudent, loginAdmin, uniq } from './helpers';

/** Phase 6: plan-tier gating — results differentiation, AI evaluation, practice, premium services, live classes. */

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
const get = (path: string) => as(admin)(http(app).get(path));

async function assignPlan(studentId: string, planName: string) {
  await post('/admin/student-plans', { studentId, planName, reason: 'test' }).expect(201);
}

async function buildDiagnostic() {
  const a = (await post('/admin/assessments', { title: `Gating diag ${uniq()}`, type: 'DIAGNOSTIC', showAnswers: true }).expect(201)).body;
  const versionId = (await get(`/admin/assessments/${a.id}`).expect(200)).body.versions[0].id as string;
  const sectionId = (await post(`/admin/assessment-versions/${versionId}/sections`, { title: 'Part 1' }).expect(201)).body.id as string;
  await post(`/admin/assessment-sections/${sectionId}/questions`, { type: 'TFNG', prompt: { text: 'Q1' }, marks: 1, answerKey: { value: 'TRUE' } }).expect(201);
  await post(`/admin/assessment-versions/${versionId}/publish`).expect(200);
  return a.id as string;
}

describe('results differentiation by plan', () => {
  it('FREE (no plan assigned) sees score only, never review', async () => {
    const assessmentId = await buildDiagnostic();
    const student = await createStudent(app, prisma);
    const started = (await as(student.session)(http(app).post(`/assessments/${assessmentId}/start`)).expect(201)).body;
    const q = started.paper[0].questions[0];
    await as(student.session)(http(app).put(`/attempts/${started.attempt.id}/answers`)).send({ revision: 0, answers: [{ questionVersionId: q.id, answer: { value: 'TRUE' } }] }).expect(200);
    const result = (await as(student.session)(http(app).post(`/attempts/${started.attempt.id}/submit`)).expect(200)).body;
    expect(result.score.raw).toBe(1);
    expect(result.review).toBeNull();
  });

  it('STARTER sees full review with answer keys', async () => {
    const assessmentId = await buildDiagnostic();
    const student = await createStudent(app, prisma);
    await assignPlan(student.studentId, 'STARTER');
    const started = (await as(student.session)(http(app).post(`/assessments/${assessmentId}/start`)).expect(201)).body;
    const q = started.paper[0].questions[0];
    await as(student.session)(http(app).put(`/attempts/${started.attempt.id}/answers`)).send({ revision: 0, answers: [{ questionVersionId: q.id, answer: { value: 'FALSE' } }] }).expect(200);
    const result = (await as(student.session)(http(app).post(`/attempts/${started.attempt.id}/submit`)).expect(200)).body;
    expect(result.review).not.toBeNull();
    expect(result.review[0].questions[0].correctAnswer).toEqual({ value: 'TRUE' });
    expect(result.review[0].questions[0].correct).toBe(false);
  });
});

describe('AI evaluation gating', () => {
  async function createEssay(session: Session) {
    return (await as(session)(http(app).post('/writing/responses')).send({ taskType: 'TASK2', promptText: 'Discuss the advantages and disadvantages of remote work in modern economies.' }).expect(201)).body;
  }
  const ESSAY_BODY = 'Remote work has become increasingly common. '.repeat(5); // > 20 words

  it('STARTER gets no AI evaluation on submit', async () => {
    const student = await createStudent(app, prisma);
    await assignPlan(student.studentId, 'STARTER');
    const essay = await createEssay(student.session);
    await as(student.session)(http(app).put(`/writing/responses/${essay.id}`)).send({ revision: 1, body: ESSAY_BODY }).expect(200);
    await as(student.session)(http(app).post(`/writing/responses/${essay.id}/submit`)).expect(200);
    const detail = (await as(student.session)(http(app).get(`/writing/responses/${essay.id}`)).expect(200)).body;
    expect(detail.evaluations).toEqual([]);
  });

  it('ADVANCED gets an AI evaluation on submit', async () => {
    const student = await createStudent(app, prisma);
    await assignPlan(student.studentId, 'ADVANCED');
    const essay = await createEssay(student.session);
    await as(student.session)(http(app).put(`/writing/responses/${essay.id}`)).send({ revision: 1, body: ESSAY_BODY }).expect(200);
    await as(student.session)(http(app).post(`/writing/responses/${essay.id}/submit`)).expect(200);
    const detail = (await as(student.session)(http(app).get(`/writing/responses/${essay.id}`)).expect(200)).body;
    expect(detail.evaluations.length).toBeGreaterThan(0);
  });
});

describe('practice gating', () => {
  it('a FREE (unassigned) student cannot start adaptive practice', async () => {
    const student = await createStudent(app, prisma);
    const res = await as(student.session)(http(app).post('/practice/sessions')).send({ skill: 'READING', count: 5 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PLAN_UPGRADE_REQUIRED');
  });
});

describe('premium services gating', () => {
  it('a STARTER student cannot book a premium service; a PREMIUM student can', async () => {
    const services = (await get('/admin/premium-services').expect(200)).body as Array<{ id: string }>;
    expect(services.length).toBeGreaterThan(0);
    const serviceId = services[0].id;

    const starter = await createStudent(app, prisma);
    await assignPlan(starter.studentId, 'STARTER');
    await as(starter.session)(http(app).post('/me/premium-services/bookings')).send({ serviceId }).expect(403);

    const premium = await createStudent(app, prisma);
    await assignPlan(premium.studentId, 'PREMIUM');
    const booking = (await as(premium.session)(http(app).post('/me/premium-services/bookings')).send({ serviceId, notes: 'Looking for help with US universities' }).expect(201)).body;
    expect(booking.status).toBe('REQUESTED');
  });

  it('confirming a booking requires a real scheduled time', async () => {
    const services = (await get('/admin/premium-services').expect(200)).body as Array<{ id: string }>;
    const premium = await createStudent(app, prisma);
    await assignPlan(premium.studentId, 'PREMIUM');
    const booking = (await as(premium.session)(http(app).post('/me/premium-services/bookings')).send({ serviceId: services[0].id }).expect(201)).body;
    await post(`/admin/premium-services/bookings/${booking.id}/decide`, { status: 'SCHEDULED' }).expect(422);
    await post(`/admin/premium-services/bookings/${booking.id}/decide`, { status: 'SCHEDULED', scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(200);
  });
});

describe('live class gating', () => {
  it('a non-PREMIUM student sees no live classes even if sessions exist on their batch', async () => {
    const batchId = await createOpenBatch(app, admin);
    const student = await enrollStudent(app, prisma, admin, batchId); // apply+verify defaults to PREMIUM
    await prisma.liveSession.create({ data: { batchId, topic: `Class ${uniq()}`, startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000) } });

    const before = (await as(student.session)(http(app).get('/me/sessions')).expect(200)).body;
    expect(before.upcoming.length).toBeGreaterThan(0); // PREMIUM (the default) sees it

    await assignPlan(student.studentId, 'ADVANCED'); // downgrade away from Premium
    const after = (await as(student.session)(http(app).get('/me/sessions')).expect(200)).body;
    expect(after.upcoming).toEqual([]);
    expect(after.past).toEqual([]);
  });
});
