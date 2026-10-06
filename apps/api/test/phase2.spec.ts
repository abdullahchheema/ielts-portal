import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { enrollStudent, createOpenBatch, Session, as, createStudent, http, loginAdmin, uniq } from './helpers';

/**
 * Writing and speaking practice with AI evaluation (mock provider), the mock composer and the full simulator.
 * Runs with AI_PROVIDER unset in the test environment, so the deterministic mock is used throughout.
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

const post = (s: Session, path: string, body: object = {}) => as(s)(http(app).post(path)).send(body);
const put = (s: Session, path: string, body: object = {}) => as(s)(http(app).put(path)).send(body);
const get = (s: Session, path: string) => as(s)(http(app).get(path));

const ESSAY = [
  'Many people believe that technology makes life easier. In my opinion, this is true in many ways.',
  'First, technology saves time. Machines do the work that once took hours. Second, technology connects families who live far apart.',
  'However, there are drawbacks. Some people spend a lot of time on screens, and this can harm sleep and health.',
].join(' ');

/** A minimal WebM header followed by padding. Enough for the server's content sniffing. */
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(400, 7)]);

describe('writing practice', () => {
  it('a student saves a draft, submits it, and receives an AI estimate that is kept apart from any grade', async () => {
    const st = await createStudent(app, prisma);
    const r = (await post(st.session, '/writing/responses', { taskType: 'TASK2', promptText: 'Some people think technology helps; discuss.' }).expect(201)).body;
    const saved = (await put(st.session, `/writing/responses/${r.id}`, { revision: 1, body: ESSAY }).expect(200)).body;
    expect(saved.revision).toBe(2);
    expect(saved.wordCount).toBeGreaterThan(40);

    await put(st.session, `/writing/responses/${r.id}`, { revision: 1, body: 'stale text from another tab' }).expect(409);

    await post(st.session, `/writing/responses/${r.id}/submit`).expect(200);
    const view = (await get(st.session, `/writing/responses/${r.id}`).expect(200)).body;
    expect(view.status).toBe('EVALUATED');
    expect(Number(view.latestEvaluation.estimatedBand)).toBeGreaterThanOrEqual(0);
    expect(view.latestEvaluation.criteria).toHaveLength(4);
    expect(view.stats.words).toBeGreaterThan(40);
    expect(view.minWords).toBe(250);

    await put(st.session, `/writing/responses/${r.id}`, { revision: 2, body: 'changed after submit' }).expect(409);
  });

  it('another student cannot read or change someone else’s essay', async () => {
    const owner = await createStudent(app, prisma);
    const other = await createStudent(app, prisma);
    const r = (await post(owner.session, '/writing/responses', { taskType: 'TASK1', promptText: 'The chart shows sales over five years.' }).expect(201)).body;
    await get(other.session, `/writing/responses/${r.id}`).expect(404);
    await put(other.session, `/writing/responses/${r.id}`, { revision: 1, body: 'intrusion' }).expect(404);
  });

  it('a submission that is too short is refused with a clear message', async () => {
    const st = await createStudent(app, prisma);
    const r = (await post(st.session, '/writing/responses', { taskType: 'TASK2', promptText: 'Discuss the role of museums in cities.' }).expect(201)).body;
    await put(st.session, `/writing/responses/${r.id}`, { revision: 1, body: 'Too short.' }).expect(200);
    await post(st.session, `/writing/responses/${r.id}/submit`).expect(422);
  });

  it('submitted practice essays appear in the student’s list', async () => {
    const st = await createStudent(app, prisma);
    const r = (await post(st.session, '/writing/responses', { taskType: 'TASK2', promptText: 'Should cities ban private cars? Discuss.' }).expect(201)).body;
    await put(st.session, `/writing/responses/${r.id}`, { revision: 1, body: ESSAY }).expect(200);
    await post(st.session, `/writing/responses/${r.id}/submit`).expect(200);
    const list = (await get(st.session, '/writing/responses').expect(200)).body;
    expect(list.map((x: { id: string }) => x.id)).toContain(r.id);
  });
});

describe('speaking practice', () => {
  it('records, uploads, transcribes and evaluates an answer, and never exposes the storage key', async () => {
    const st = await createStudent(app, prisma);
    const attempt = (await post(st.session, '/speaking/attempts', { mode: 'PART1' }).expect(201)).body;
    const resp = (await post(st.session, `/speaking/attempts/${attempt.id}/responses`, { part: 'PART1', promptText: 'What do you do in your free time?' }).expect(201)).body;

    const presign = (await post(st.session, `/speaking/responses/${resp.id}/presign`, { mime: 'audio/webm', sizeBytes: WEBM.length }).expect(200)).body;
    expect(presign.mode).toBe('multipart');

    const up = await as(st.session)(http(app).post(`/speaking/responses/${resp.id}/audio`)).attach('file', WEBM, { filename: 'answer.webm', contentType: 'audio/webm' });
    expect(up.status).toBe(200);

    const view = (await get(st.session, `/speaking/responses/${resp.id}`).expect(200)).body;
    expect(view.status).toBe('EVALUATED');
    expect(view.transcript).toBeTruthy();
    expect(view.latestEvaluation.criteria.find((c: { key: string }) => c.key === 'PRONUNCIATION').score).toBeNull();
    expect(JSON.stringify(view)).not.toContain('speaking/');
  });

  it('refuses a file that is not audio, whatever its declared type', async () => {
    const st = await createStudent(app, prisma);
    const attempt = (await post(st.session, '/speaking/attempts', { mode: 'PART2' }).expect(201)).body;
    const resp = (await post(st.session, `/speaking/attempts/${attempt.id}/responses`, { part: 'PART2', promptText: 'Describe a place you like.' }).expect(201)).body;
    await post(st.session, `/speaking/responses/${resp.id}/presign`, { mime: 'audio/webm', sizeBytes: 100 }).expect(200);
    const bad = await as(st.session)(http(app).post(`/speaking/responses/${resp.id}/audio`)).attach('file', Buffer.from('<html>not audio</html>'), { filename: 'a.webm', contentType: 'audio/webm' });
    expect(bad.status).toBe(422);
  });

  it('another student cannot see or retry someone else’s answer', async () => {
    const owner = await createStudent(app, prisma);
    const other = await createStudent(app, prisma);
    const attempt = (await post(owner.session, '/speaking/attempts', { mode: 'PART3' }).expect(201)).body;
    const resp = (await post(owner.session, `/speaking/attempts/${attempt.id}/responses`, { part: 'PART3', promptText: 'Why do people travel?' }).expect(201)).body;
    await get(other.session, `/speaking/responses/${resp.id}`).expect(404);
    await post(other.session, `/speaking/responses/${resp.id}/retry`).expect(404);
  });
});

describe('mock composer and full simulator', () => {
  async function publishedFor(skill: 'LISTENING' | 'READING', count: number) {
    const set = (await post(admin, '/admin/question-sets', { title: `Sim ${skill} ${uniq()}`, skill, difficulty: 3, topic: `sim-${uniq()}`, studentFacing: false }).expect(201)).body;
    for (let i = 0; i < count; i++) {
      await post(admin, `/admin/question-sets/${set.id}/questions`, { ieltsType: 'TFNG', prompt: { text: `Item ${i}` }, marks: 1, answerKey: { value: 'TRUE' } }).expect(201);
    }
    await post(admin, `/admin/question-sets/${set.id}/status`, { status: 'APPROVED' }).expect(200);
    await post(admin, `/admin/question-sets/${set.id}/status`, { status: 'PUBLISHED', studentFacing: true }).expect(200);
    return set.id as string;
  }

  it('composes a draft mock only from enough published content, and refuses otherwise', async () => {
    await post(admin, '/admin/mock-exams/compose', { title: `Too big ${uniq()}`, skill: 'LISTENING', count: 60, durationMin: 30 }).expect(422);
  });

  it('a student completes listening and reading; the simulator records the skills it could not assess', async () => {
    await publishedFor('LISTENING', 6);
    await publishedFor('READING', 6);
    const title = `Mock ${uniq()}`;
    const listening = (await post(admin, '/admin/mock-exams/compose', { title: `${title} L`, skill: 'LISTENING', count: 5, durationMin: 30, topic: undefined }).expect(201)).body;
    const reading = (await post(admin, '/admin/mock-exams/compose', { title: `${title} R`, skill: 'READING', count: 5, durationMin: 60, topic: undefined }).expect(201)).body;
    for (const m of [listening, reading]) {
      await as(admin)(http(app).post(`/admin/assessment-versions/${m.draftVersionId}/publish`)).expect((r) => expect([200, 201]).toContain(r.status));
      await post(admin, `/admin/mock-exams/${m.assessmentId}/library`, { visible: true }).expect(200);
    }

    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    const available = (await get(st.session, '/simulator/available').expect(200)).body;
    expect(available.listening.map((x: { id: string }) => x.id)).toContain(listening.assessmentId);
    expect(available.reading.map((x: { id: string }) => x.id)).toContain(reading.assessmentId);

    const exam = (await post(st.session, '/simulator/exams', { listeningAssessmentId: listening.assessmentId, readingAssessmentId: reading.assessmentId, includeSpeaking: false }).expect(201)).body;
    expect(exam.stage).toBe('LISTENING');
    expect(exam.stageRevision).toBe(0);
    expect(exam.sections.listening.attemptId).toBeTruthy();

    await post(st.session, `/simulator/exams/${exam.id}/advance`, { expectedRevision: 0 }).expect(409);
    await post(st.session, `/attempts/${exam.sections.listening.attemptId}/submit`).expect((r) => expect([200, 201]).toContain(r.status));
    const afterListening = (await post(st.session, `/simulator/exams/${exam.id}/advance`, { expectedRevision: 0 }).expect(200)).body;
    expect(afterListening.stage).toBe('READING');
    expect(afterListening.stageRevision).toBe(1);

    await post(st.session, `/simulator/exams/${exam.id}/advance`, { expectedRevision: 0 }).expect(409);

    const midway = (await get(st.session, `/simulator/exams/${exam.id}`).expect(200)).body;
    await post(st.session, `/attempts/${midway.sections.reading.attemptId}/submit`).expect((r) => expect([200, 201]).toContain(r.status));
    const done = (await post(st.session, `/simulator/exams/${exam.id}/advance`, { expectedRevision: 1 }).expect(200)).body;
    expect(done.status).toBe('COMPLETED');
    expect(done.stage).toBe('DONE');
    expect(done.overallEstimate).toBeNull();
    expect(done.missingSkills).toContain('WRITING');

    await post(st.session, `/simulator/exams/${exam.id}/advance`, { expectedRevision: 2 }).expect(409);
  }, 180_000);

  it('a student who is not enrolled cannot start a simulator, even with published mocks', async () => {
    const st = await createStudent(app, prisma);
    const res = await get(st.session, '/simulator/available').expect(200);
    expect(res.body.listening).toEqual(expect.any(Array));
    await post(st.session, '/simulator/exams', { listeningAssessmentId: crypto.randomUUID(), readingAssessmentId: crypto.randomUUID(), includeSpeaking: false }).expect(404);
  });
});
