import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { Session, as, createOpenBatch, enrollStudent, http, loginAdmin, uniq } from './helpers';

/**
 * Phase 6: whole-module mock-test composition. One admin click (POST /admin/mock-exams/compose,
 * `{ title }` only) picks the least-used published Listening module and the least-used published
 * Reading module via RotationService — the same picker FreeTestService uses, sharing one usage
 * counter — resolves/reuses their wrapper assessments, and publishes the bundle as library-visible
 * in one step. See mocks.spec.ts for the pre-existing single-assessment access-control mechanics,
 * which this file's MockExam-keyed twins (requestMockExam/activateMockExam/...) reuse unchanged.
 */

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

/** A published, student-facing bank set for one skill, with one TFNG question — enough to make a
 *  wrapper-assessment build succeed. */
async function buildBankModule(skill: 'LISTENING' | 'READING') {
  const set = (await post('/admin/question-sets', { title: `Mock ${skill} ${uniq()}`, skill, difficulty: 3, topic: `mock-${uniq()}`, studentFacing: false }).expect(201)).body;
  await post(`/admin/question-sets/${set.id}/questions`, { ieltsType: 'TFNG', prompt: { text: 'Q1' }, marks: 1, answerKey: { value: 'TRUE' } }).expect(201);
  await post(`/admin/question-sets/${set.id}/status`, { status: 'PUBLISHED', studentFacing: true }).expect(200);
  return set.id as string;
}

describe('mock-exam composition', () => {
  it('composes a mock exam in one step: picked, built, published, and library-visible immediately', async () => {
    await buildBankModule('LISTENING');
    await buildBankModule('READING');
    const mockExam = (await post('/admin/mock-exams/compose', { title: `Mock ${uniq()}` }).expect(201)).body;
    expect(mockExam.status).toBe('PUBLISHED');
    expect(mockExam.libraryVisible).toBe(true);
    expect(mockExam.listeningAssessmentId).toBeTruthy();
    expect(mockExam.readingAssessmentId).toBeTruthy();

    const list = (await get('/admin/mock-exams?take=100').expect(200)).body as { items: Array<{ id: string }>; total: number };
    expect(list.items.some((m) => m.id === mockExam.id)).toBe(true);
  });

  it('rotation is shared with free-test: a module just used by a mock exam counts toward free-test\'s own least-used pick', async () => {
    const a = await buildBankModule('LISTENING');
    const b = await buildBankModule('LISTENING');
    await buildBankModule('READING');

    // Compose enough mock exams that one of the two brand-new Listening modules gets picked at
    // least once (each starts at zero uses, so one of them must win the very first pick).
    const mockExam = (await post('/admin/mock-exams/compose', { title: `Rot ${uniq()}` }).expect(201)).body;
    const usedSet = await prisma.questionSet.findFirst({ where: { wrapperAssessmentId: mockExam.listeningAssessmentId }, select: { id: true } });
    expect([a, b]).toContain(usedSet!.id);

    // That same module must now show up as "used" from free-test's perspective too (one shared
    // counter) — claim free-test leads until the *other* new module is picked, and confirm the
    // mock-exam's pick is never the one free-test favours again immediately (it already has a use).
    const other = usedSet!.id === a ? b : a;
    let pickedOther = false;
    for (let i = 0; i < 8 && !pickedOther; i++) {
      const claim = (await http(app).post('/free-test/claim').expect(201)).body;
      const lead = await prisma.freeAssessmentLead.findUniqueOrThrow({ where: { id: claim.leadId }, include: { examAttempt: true } });
      const assessmentId = lead.examAttempt?.listeningAssessmentId;
      if (assessmentId) {
        const set = await prisma.questionSet.findFirst({ where: { wrapperAssessmentId: assessmentId }, select: { id: true } });
        if (set?.id === other) pickedOther = true;
      }
    }
    expect(pickedOther).toBe(true);
  });
});

describe('mock-exam access control (bundle shape)', () => {
  async function composedExam() {
    await buildBankModule('LISTENING');
    await buildBankModule('READING');
    const mockExam = (await post('/admin/mock-exams/compose', { title: `Bundle ${uniq()}` }).expect(201)).body;
    const batchId = await createOpenBatch(app, admin);
    return { mockExamId: mockExam.id as string, batchId };
  }

  it('blocks starting a mock exam until an approved request is within its window, then allows it', async () => {
    const { mockExamId, batchId } = await composedExam();
    const st = await enrollStudent(app, prisma, admin, batchId);

    const blocked = await as(st.session)(http(app).post('/simulator/exams/from-mock-exam')).send({ mockExamId, includeSpeaking: false });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('MOCK_ACCESS_REQUIRED');

    const req = (await as(st.session)(http(app).post(`/mock-exams/${mockExamId}/access-requests`)).send({}).expect(201)).body;
    expect(req.status).toBe('PENDING');
    expect(req.mockExamId).toBe(mockExamId);

    await post(`/mentor/mock-access-requests/${req.id}/approve`).expect(200);

    const started = (await as(st.session)(http(app).post('/simulator/exams/from-mock-exam')).send({ mockExamId, includeSpeaking: false }).expect(201)).body;
    expect(started.stage).toBe('LISTENING');
  }, 60_000);

  it('a batch activation opens the bundle for the whole batch with one call, not two', async () => {
    const { mockExamId, batchId } = await composedExam();
    const st = await enrollStudent(app, prisma, admin, batchId);

    const activation = (await post(`/mentor/mock-exams/${mockExamId}/mock-activations`, {
      batchId, availableFrom: new Date(Date.now() - 1000).toISOString(),
    }).expect(201)).body;
    expect(activation.status).toBe('ACTIVE');
    expect(activation.mockExamId).toBe(mockExamId);

    const started = (await as(st.session)(http(app).post('/simulator/exams/from-mock-exam')).send({ mockExamId, includeSpeaking: false }).expect(201)).body;
    expect(started.stage).toBe('LISTENING');
  }, 60_000);

  it('hiding a mock exam from the library makes it unavailable to start, even with an approved request', async () => {
    const { mockExamId, batchId } = await composedExam();
    const st = await enrollStudent(app, prisma, admin, batchId);
    const req = (await as(st.session)(http(app).post(`/mock-exams/${mockExamId}/access-requests`)).send({}).expect(201)).body;
    await post(`/mentor/mock-access-requests/${req.id}/approve`).expect(200);

    await post(`/admin/mock-exams/${mockExamId}/library`, { visible: false }).expect(200);
    const blocked = await as(st.session)(http(app).post('/simulator/exams/from-mock-exam')).send({ mockExamId, includeSpeaking: false });
    expect(blocked.status).toBe(404);
  });
});
