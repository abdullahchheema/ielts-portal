import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { PASSWORD, Session, as, createOpenBatch, createStudent, enrollStudent, http, login, loginAdmin, newCourse, uniq } from './helpers';

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

async function mentor(batchId: string | null) {
  const email = `mentor-${uniq()}@test.local`;
  const m = (await post('/admin/mentors', { email, displayName: 'Mentor ' + uniq(), password: PASSWORD }).expect(201)).body;
  if (batchId) await post(`/admin/batches/${batchId}/mentors`, { mentorId: m.id, mentorRole: 'MAIN' }).expect(201);
  return { id: m.id as string, session: await login(app, email) };
}

/** A published MOCK assessment (one MCQ question) bound to a content item inside a fresh batch's course. */
async function buildMockAssessment() {
  const a = (await post('/admin/assessments', { title: `Mock ${uniq()}`, type: 'MOCK' }).expect(201)).body;
  const versionId = (await as(admin)(http(app).get(`/admin/assessments/${a.id}`)).expect(200)).body.versions[0].id as string;
  const sectionId = (await post(`/admin/assessment-versions/${versionId}/sections`, { title: 'Part 1', content: { instructions: 'Answer.' } }).expect(201)).body.id as string;
  await post(`/admin/assessment-sections/${sectionId}/questions`, { type: 'MCQ_SINGLE', prompt: { text: 'Pick B' }, options: [{ label: 'A' }, { label: 'B', isCorrect: true }] }).expect(201);
  await post(`/admin/assessment-versions/${versionId}/publish`).expect(200);

  const nc = await newCourse(app, admin, prisma, 1000);
  const sec = (await post(`/admin/course-versions/${nc.versionId}/sections`, { title: 'Mock tests' }).expect(201)).body.id as string;
  await post(`/admin/sections/${sec}/items`, { title: 'Mock test 1', contentType: 'QUIZ', metadata: { assessmentId: a.id } }).expect(201);
  await post(`/admin/course-versions/${nc.versionId}/publish`).expect(200);

  const batchId = await createOpenBatch(app, admin);
  return { assessmentId: a.id as string, batchId };
}

describe('mock access requests', () => {
  it('blocks start until an approved request is within its window, then allows it', async () => {
    const { assessmentId, batchId } = await buildMockAssessment();
    const main = await mentor(batchId);
    const st = await enrollStudent(app, prisma, admin, batchId);
    const stApi = (p: string) => as(st.session)(http(app).post(p));

    const blocked = await stApi(`/assessments/${assessmentId}/start`).expect(403);
    expect(blocked.body.error.code).toBe('MOCK_ACCESS_REQUIRED');

    const req = (await stApi(`/assessments/${assessmentId}/mock-access-requests`).send({ reason: 'Ready for practice' }).expect(201)).body;
    expect(req.status).toBe('PENDING');

    // Duplicate request while pending is rejected.
    await stApi(`/assessments/${assessmentId}/mock-access-requests`).send({}).expect(409);

    // Still blocked — only PENDING so far.
    await stApi(`/assessments/${assessmentId}/start`).expect(403);

    const queue = (await as(main.session)(http(app).get('/mentor/mock-access-requests')).expect(200)).body as Array<{ id: string; status: string }>;
    expect(queue.find((r) => r.id === req.id)?.status).toBe('PENDING');

    await as(main.session)(http(app).post(`/mentor/mock-access-requests/${req.id}/approve`)).send({}).expect(200);

    const started = (await stApi(`/assessments/${assessmentId}/start`).expect(201)).body;
    expect(started.attempt?.id ?? started.id).toBeTruthy();
  }, 30_000);

  it('declining a request keeps the student blocked, with a reviewer note visible to them', async () => {
    const { assessmentId, batchId } = await buildMockAssessment();
    const main = await mentor(batchId);
    const st = await enrollStudent(app, prisma, admin, batchId);

    const req = (await as(st.session)(http(app).post(`/assessments/${assessmentId}/mock-access-requests`)).send({}).expect(201)).body;
    await as(main.session)(http(app).post(`/mentor/mock-access-requests/${req.id}/decline`)).send({ decisionNote: 'Finish the foundation unit first.' }).expect(200);

    await as(st.session)(http(app).post(`/assessments/${assessmentId}/start`)).expect(403);
    const mine = (await as(st.session)(http(app).get('/me/mock-access-requests')).expect(200)).body as Array<{ status: string; decisionNote: string | null }>;
    expect(mine[0]).toMatchObject({ status: 'DECLINED', decisionNote: 'Finish the foundation unit first.' });
  });

  it('a batch-wide activation opens the mock for every enrolled student without an individual request', async () => {
    const { assessmentId, batchId } = await buildMockAssessment();
    const otherBatchId = await createOpenBatch(app, admin);
    const main = await mentor(batchId);
    const outsider = await mentor(otherBatchId);
    const st1 = await enrollStudent(app, prisma, admin, batchId);
    const st2 = await enrollStudent(app, prisma, admin, batchId);
    const otherStudent = await enrollStudent(app, prisma, admin, otherBatchId);

    await as(outsider.session)(http(app).post(`/mentor/assessments/${assessmentId}/mock-activations`)).send({
      batchId, availableFrom: new Date(Date.now() - 1000).toISOString(),
    }).expect(403);

    const activation = (await as(main.session)(http(app).post(`/mentor/assessments/${assessmentId}/mock-activations`)).send({
      batchId, availableFrom: new Date(Date.now() - 1000).toISOString(), instructions: 'Full 3-hour mock, no breaks.',
    }).expect(201)).body;
    expect(activation.status).toBe('ACTIVE');

    await as(st1.session)(http(app).post(`/assessments/${assessmentId}/start`)).expect(201);
    await as(st2.session)(http(app).post(`/assessments/${assessmentId}/start`)).expect(201);

    // A student in an unrelated batch gets no access from this activation.
    await as(otherStudent.session)(http(app).post(`/assessments/${assessmentId}/start`)).expect(403);

    const list = (await as(main.session)(http(app).get(`/mentor/batches/${batchId}/mock-activations`)).expect(200)).body as Array<{ id: string; status: string }>;
    expect(list.find((a) => a.id === activation.id)?.status).toBe('ACTIVE');

    await as(main.session)(http(app).delete(`/mentor/mock-activations/${activation.id}`)).expect(204);
    const afterCancel = (await as(main.session)(http(app).get(`/mentor/batches/${batchId}/mock-activations`)).expect(200)).body as Array<{ id: string; status: string }>;
    expect(afterCancel.find((a) => a.id === activation.id)?.status).toBe('CANCELLED');
  }, 30_000);

  it('an activation outside its availability window does not grant access', async () => {
    const { assessmentId, batchId } = await buildMockAssessment();
    const main = await mentor(batchId);
    const st = await enrollStudent(app, prisma, admin, batchId);

    await as(main.session)(http(app).post(`/mentor/assessments/${assessmentId}/mock-activations`)).send({
      batchId, availableFrom: new Date(Date.now() + 3_600_000).toISOString(),
    }).expect(201);

    const blocked = await as(st.session)(http(app).post(`/assessments/${assessmentId}/start`)).expect(403);
    expect(blocked.body.error.code).toBe('MOCK_ACCESS_REQUIRED');
  });

  it('rejects access-request creation against a non-MOCK assessment', async () => {
    const quiz = (await post('/admin/assessments', { title: `Quiz ${uniq()}`, type: 'QUIZ' }).expect(201)).body;
    const st = await createStudent(app, prisma);
    const res = await as(st.session)(http(app).post(`/assessments/${quiz.id}/mock-access-requests`)).send({}).expect(422);
    expect(res.body.error).toBeTruthy();
  });
});
