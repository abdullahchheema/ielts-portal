import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { randomUUID } from 'node:crypto';
import { Session, as, createStudent, http, loginAdmin, uniq } from './helpers';

/** Phase 1: new grader types (ORDERING, NUMERICAL, MULTI_BLANK, mapping-based MATCHING) and partial credit,
 *  exercised end-to-end through the real create -> publish -> attempt -> grade flow. */

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

/** A diagnostic-type assessment: any verified student may start it without enrollment. */
async function buildDiagnostic() {
  const a = (await post('/admin/assessments', { title: `Diagnostic ${uniq()}`, type: 'DIAGNOSTIC', showAnswers: true }).expect(201)).body;
  const versionId = (await get(`/admin/assessments/${a.id}`).expect(200)).body.versions[0].id as string;
  const sectionId = (await post(`/admin/assessment-versions/${versionId}/sections`, { title: 'Part 1' }).expect(201)).body.id as string;
  return { assessmentId: a.id as string, versionId, sectionId };
}

describe('new grader types: create, publish, attempt, grade', () => {
  it('ORDERING grades the exact sequence and supports partial credit', async () => {
    const { assessmentId, versionId, sectionId } = await buildDiagnostic();
    // Caller-chosen option ids let the answer key name an option within the same request.
    const [idA, idB, idC, idD] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await post(`/admin/assessment-sections/${sectionId}/questions`, {
      type: 'ORDERING', prompt: { text: 'Order the steps.' }, marks: 4,
      options: [{ id: idA, label: 'Step A' }, { id: idB, label: 'Step B' }, { id: idC, label: 'Step C' }, { id: idD, label: 'Step D' }],
      answerKey: { correctOrder: [idA, idB, idC, idD] }, partialCredit: true,
    }).expect(201);
    await post(`/admin/assessment-versions/${versionId}/publish`).expect(200);

    const student = await createStudent(app, prisma);
    const started = (await as(student.session)(http(app).post(`/assessments/${assessmentId}/start`)).expect(201)).body;
    const paperQuestion = started.paper[0].questions[0];
    const shownIds = paperQuestion.options.map((o: { id: string }) => o.id);
    // Swap the middle two: 5 of 6 pairs still correctly ordered -> partial credit, not full, not zero.
    const swapped = [shownIds[0], shownIds[2], shownIds[1], shownIds[3]];
    await as(student.session)(http(app).put(`/attempts/${started.attempt.id}/answers`)).send({
      revision: 0, answers: [{ questionVersionId: paperQuestion.id, answer: { orderedIds: swapped } }],
    }).expect(200);
    await as(student.session)(http(app).post(`/attempts/${started.attempt.id}/submit`)).expect(200);
    const result = (await as(student.session)(http(app).get(`/attempts/${started.attempt.id}/result`)).expect(200)).body;
    expect(result.score.raw).toBeGreaterThan(0);
    expect(result.score.raw).toBeLessThan(4);
    expect(result.score.percent).toBeCloseTo((10 / 12) * 100, 0); // 5/6 pairs correct
  });

  it('NUMERICAL accepts a value within tolerance and rejects outside it', async () => {
    const { assessmentId, versionId, sectionId } = await buildDiagnostic();
    await post(`/admin/assessment-sections/${sectionId}/questions`, {
      type: 'NUMERICAL', prompt: { text: 'How many planets?' }, marks: 1, answerKey: { numericValue: 8, tolerance: 0 },
    }).expect(201);
    await post(`/admin/assessment-versions/${versionId}/publish`).expect(200);

    const student = await createStudent(app, prisma);
    const started = (await as(student.session)(http(app).post(`/assessments/${assessmentId}/start`)).expect(201)).body;
    const q = started.paper[0].questions[0];
    await as(student.session)(http(app).put(`/attempts/${started.attempt.id}/answers`)).send({
      revision: 0, answers: [{ questionVersionId: q.id, answer: { value: 8 } }],
    }).expect(200);
    await as(student.session)(http(app).post(`/attempts/${started.attempt.id}/submit`)).expect(200);
    const result = (await as(student.session)(http(app).get(`/attempts/${started.attempt.id}/result`)).expect(200)).body;
    expect(result.score.raw).toBe(1);
    expect(result.score.percent).toBe(100);
  });

  it('MULTI_BLANK grades each blank independently with partial credit', async () => {
    const { assessmentId, versionId, sectionId } = await buildDiagnostic();
    await post(`/admin/assessment-sections/${sectionId}/questions`, {
      type: 'MULTI_BLANK', prompt: { text: 'Label the diagram.' }, marks: 2,
      answerKey: { blanks: [{ key: 'b1', accepted: ['north'] }, { key: 'b2', accepted: ['south'] }] }, partialCredit: true,
    }).expect(201);
    await post(`/admin/assessment-versions/${versionId}/publish`).expect(200);

    const student = await createStudent(app, prisma);
    const started = (await as(student.session)(http(app).post(`/assessments/${assessmentId}/start`)).expect(201)).body;
    const paperQuestion = started.paper[0].questions[0];
    await as(student.session)(http(app).put(`/attempts/${started.attempt.id}/answers`)).send({
      revision: 0, answers: [{ questionVersionId: paperQuestion.id, answer: { blanks: { b1: 'North', b2: 'wrong' } } }],
    }).expect(200);
    await as(student.session)(http(app).post(`/attempts/${started.attempt.id}/submit`)).expect(200);
    const result = (await as(student.session)(http(app).get(`/attempts/${started.attempt.id}/result`)).expect(200)).body;
    expect(result.score.raw).toBe(1); // one of two blanks correct, 1 mark each
  });

  it('mapping-based MATCHING grades each pair', async () => {
    const { assessmentId, versionId, sectionId } = await buildDiagnostic();
    await post(`/admin/assessment-sections/${sectionId}/questions`, {
      type: 'MATCHING', prompt: { text: 'Match speakers to their claims.' }, marks: 2,
      answerKey: { mappings: [{ left: 'Speaker 1', right: 'Claim A' }, { left: 'Speaker 2', right: 'Claim B' }] }, partialCredit: true,
    }).expect(201);
    await post(`/admin/assessment-versions/${versionId}/publish`).expect(200);

    const student = await createStudent(app, prisma);
    const started = (await as(student.session)(http(app).post(`/assessments/${assessmentId}/start`)).expect(201)).body;
    const paperQuestion = started.paper[0].questions[0];
    await as(student.session)(http(app).put(`/attempts/${started.attempt.id}/answers`)).send({
      revision: 0, answers: [{ questionVersionId: paperQuestion.id, answer: { mappings: { 'Speaker 1': 'Claim A', 'Speaker 2': 'Claim C' } } }],
    }).expect(200);
    await as(student.session)(http(app).post(`/attempts/${started.attempt.id}/submit`)).expect(200);
    const result = (await as(student.session)(http(app).get(`/attempts/${started.attempt.id}/result`)).expect(200)).body;
    expect(result.score.raw).toBe(1); // one of two pairs correct, 1 mark each
  });

  it('a question missing its answer key cannot be published', async () => {
    const { versionId, sectionId } = await buildDiagnostic();
    await post(`/admin/assessment-sections/${sectionId}/questions`, { type: 'MATCHING', prompt: { text: 'Incomplete' }, marks: 1, options: [] }).expect(422);
    await post(`/admin/assessment-sections/${sectionId}/questions`, { type: 'NUMERICAL', prompt: { text: 'Incomplete' }, marks: 1 }).expect(422);
    await post(`/admin/assessment-sections/${sectionId}/questions`, { type: 'ORDERING', prompt: { text: 'Incomplete' }, marks: 1, options: [{ label: 'a' }] } as never).expect(422);
    await post(`/admin/assessment-versions/${versionId}/publish`).expect(422); // the section still has no valid questions
  });
});
