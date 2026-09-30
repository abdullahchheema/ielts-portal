import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { AttemptsService } from '../src/assessments/attempts.service';
import { Session, as, createOpenBatch, createStudent, newCourse, http, loginAdmin, uniq } from './helpers';

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
const patch = (path: string, body: object) => as(admin)(http(app).patch(path)).send(body);

interface Built { assessmentId: string; versionId: string; sectionId: string }

/** 4 questions: MCQ (B), TFNG (TRUE), COMPLETION (library), MCQ_MULTI (A+C). */
async function buildAssessment(over: Record<string, unknown> = {}): Promise<Built> {
  const a = (await post('/admin/assessments', { title: `Quiz ${uniq()}`, type: 'QUIZ', ...over }).expect(201)).body;
  const versionId = (await as(admin)(http(app).get(`/admin/assessments/${a.id}`)).expect(200)).body.versions[0].id as string;
  const sectionId = (await post(`/admin/assessment-versions/${versionId}/sections`, { title: 'Part 1', content: { instructions: 'Answer all questions.' } }).expect(201)).body.id as string;
  const q = (body: object) => post(`/admin/assessment-sections/${sectionId}/questions`, body).expect(201);
  await q({ type: 'MCQ_SINGLE', prompt: { text: 'Pick B' }, options: [{ label: 'A' }, { label: 'B', isCorrect: true }, { label: 'C' }] });
  await q({ type: 'TFNG', prompt: { text: 'The sky is blue' }, answerKey: { value: 'TRUE' } });
  await q({ type: 'COMPLETION', prompt: { text: 'The ___ is open' }, answerKey: { accepted: ['library', 'the library'] } });
  await q({ type: 'MCQ_MULTI', prompt: { text: 'Pick A and C' }, options: [{ label: 'A', isCorrect: true }, { label: 'B' }, { label: 'C', isCorrect: true }, { label: 'D' }] });
  await post(`/admin/assessment-versions/${versionId}/publish`).expect(200);
  return { assessmentId: a.id, versionId, sectionId };
}

/** Publishes a course whose first item is a QUIZ linked to the assessment; returns item id + enrolled student. */
async function courseWith(assessmentId: string, extraItems: (sectionId: string, quizItemId: string) => Promise<void> = async () => undefined) {
  const s = uniq();
  const nc = await newCourse(app, admin, prisma, 1000);
  const course = { id: nc.courseId };
  const versionId = nc.versionId;
  const sec = (await post(`/admin/course-versions/${versionId}/sections`, { title: 'Listening' }).expect(201)).body.id as string;
  const quizItem = (await post(`/admin/sections/${sec}/items`, { title: 'The quiz', contentType: 'QUIZ', metadata: { assessmentId } }).expect(201)).body.id as string;
  await extraItems(sec, quizItem);
  await post(`/admin/course-versions/${versionId}/publish`).expect(200);
  const batchId = await createOpenBatch(app, admin);
  return { courseId: course.id as string, quizItem, batchId, sec };
}

async function enrol(batchId: string) {
  const st = await createStudent(app, prisma);
  const e = (await post('/admin/enrollments', { studentId: st.studentId, batchId, source: 'ADMIN', reason: 'test' }).expect(201)).body;
  return { ...st, enrollmentId: e.id as string };
}

type Student = Awaited<ReturnType<typeof enrol>>;
const api = (st: { session: Session }) => ({
  get: (p: string) => as(st.session)(http(app).get(p)),
  post: (p: string, b: object = {}) => as(st.session)(http(app).post(p)).send(b),
  put: (p: string, b: object) => as(st.session)(http(app).put(p)).send(b),
});

interface PaperQ { id: string; type: string; prompt: { text: string }; options?: { id: string; label: string }[] }
const questionsOf = (attempt: { paper: { questions: PaperQ[] }[] }) => attempt.paper.flatMap((s) => s.questions);

/** Builds the answer payload for the four standard questions. `wrong` lists prompts to answer incorrectly. */
function answersFor(qs: PaperQ[], wrong: string[] = []) {
  const opt = (q: PaperQ, labels: string[]) => q.options!.filter((o) => labels.includes(o.label)).map((o) => o.id);
  return qs.flatMap((q) => {
    const bad = wrong.includes(q.prompt.text);
    switch (q.prompt.text) {
      case 'Pick B': return [{ questionVersionId: q.id, answer: { optionIds: opt(q, bad ? ['A'] : ['B']) } }];
      case 'The sky is blue': return [{ questionVersionId: q.id, answer: { value: bad ? 'FALSE' : 'TRUE' } }];
      case 'The ___ is open': return [{ questionVersionId: q.id, answer: { text: bad ? 'park' : ' The  Library. ' } }];
      case 'Pick A and C': return [{ questionVersionId: q.id, answer: { optionIds: opt(q, bad ? ['A'] : ['A', 'C']) } }];
      default: return [];
    }
  });
}

async function startAttempt(st: Student, assessmentId: string) {
  return (await api(st).post(`/assessments/${assessmentId}/start`).expect(201)).body;
}

describe('authoring', () => {
  it('validates questions, blocks empty publishes, freezes published versions, and needs assessment.manage', async () => {
    const a = (await post('/admin/assessments', { title: 'Authoring', type: 'QUIZ' }).expect(201)).body;
    const v = (await as(admin)(http(app).get(`/admin/assessments/${a.id}`)).expect(200)).body.versions[0].id;
    const sec = (await post(`/admin/assessment-versions/${v}/sections`, { title: 'S' }).expect(201)).body.id;

    await post(`/admin/assessment-versions/${v}/publish`).expect(422); // empty
    for (const bad of [
      { type: 'MCQ_SINGLE', prompt: { text: 'x' }, options: [{ label: 'A' }, { label: 'B' }] }, // no correct option
      { type: 'MCQ_SINGLE', prompt: { text: 'x' }, options: [{ label: 'A', isCorrect: true }, { label: 'B', isCorrect: true }] }, // two correct
      { type: 'TFNG', prompt: { text: 'x' }, answerKey: { value: 'YES' } },
      { type: 'COMPLETION', prompt: { text: 'x' }, answerKey: { accepted: [] } },
      { type: 'MCQ_SINGLE', prompt: { text: 'x' }, options: [{ label: 'A', isCorrect: true }, { label: 'a' }] }, // duplicate labels
    ]) {
      expect((await post(`/admin/assessment-sections/${sec}/questions`, bad).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    }
    await post(`/admin/assessment-sections/${sec}/questions`, { type: 'TFNG', prompt: { text: 'ok' }, answerKey: { value: 'FALSE' } }).expect(201);
    await post(`/admin/assessment-versions/${v}/publish`).expect(200);

    // Frozen.
    expect((await post(`/admin/assessment-versions/${v}/sections`, { title: 'late' }).expect(409)).body.error.code).toBe('VERSION_PUBLISHED_IMMUTABLE');
    expect((await patch(`/admin/assessment-sections/${sec}`, { title: 'x' }).expect(409)).body.error.code).toBe('VERSION_PUBLISHED_IMMUTABLE');

    const student = await createStudent(app, prisma);
    await as(student.session)(http(app).post('/admin/assessments')).send({ title: 'nope', type: 'QUIZ' }).expect(403);
  });

  it('clones into a new version without touching the published one', async () => {
    const b = await buildAssessment();
    const v2 = (await post(`/admin/assessments/${b.assessmentId}/versions`).expect(201)).body;
    expect(v2.version).toBe(2);
    await post(`/admin/assessments/${b.assessmentId}/versions`).expect(409); // one draft at a time
    const full1 = (await as(admin)(http(app).get(`/admin/assessment-versions/${b.versionId}`)).expect(200)).body;
    const full2 = (await as(admin)(http(app).get(`/admin/assessment-versions/${v2.id}`)).expect(200)).body;
    expect(full2.sections[0].questions).toHaveLength(4);
    expect(full2.sections[0].questions[0].id).not.toBe(full1.sections[0].questions[0].id);
    // edit the draft; v1 stays as it was
    await patch(`/admin/assessment-questions/${full2.sections[0].questions[1].id}`, { answerKey: { value: 'FALSE' } }).expect(200);
    const again = (await as(admin)(http(app).get(`/admin/assessment-versions/${b.versionId}`)).expect(200)).body;
    expect(again.sections[0].questions[1].answerKey).toEqual({ value: 'TRUE' });
  });
});

describe('taking a test', () => {
  it("never leaks answers, resumes the same attempt, and is private to its owner", async () => {
    const b = await buildAssessment();
    const c = await courseWith(b.assessmentId);
    const st = await enrol(c.batchId);

    const [first, ...rest] = await Promise.all(Array.from({ length: 5 }, () => api(st).post(`/assessments/${b.assessmentId}/start`)));
    const ids = new Set([first, ...rest].filter((r) => r.status === 201).map((r) => r.body.attempt.id));
    expect(ids.size).toBe(1); // parallel starts collapse into one attempt
    expect(await prisma.assessmentAttempt.count({ where: { assessmentId: b.assessmentId, studentId: st.studentId } })).toBe(1);

    const attempt = first.body;
    const json = JSON.stringify(attempt);
    expect(json).not.toContain('isCorrect');
    expect(json).not.toContain('answerKey');
    expect(json).not.toContain('accepted');
    expect(attempt.paper[0].content.instructions).toBe('Answer all questions.');
    expect(attempt.attempt.remainingSeconds).toBeNull(); // untimed

    const other = await enrol(c.batchId);
    await api(other).get(`/attempts/${attempt.attempt.id}`).expect(404);
    await api(other).put(`/attempts/${attempt.attempt.id}/answers`, { revision: 0, answers: [] }).expect(404);
  }, 90_000);

  it('autosaves with revisions and refuses stale or malformed writes', async () => {
    const b = await buildAssessment();
    const c = await courseWith(b.assessmentId);
    const st = await enrol(c.batchId);
    const at = await startAttempt(st, b.assessmentId);
    const qs = questionsOf(at);
    const ans = answersFor(qs);

    const saved = (await api(st).put(`/attempts/${at.attempt.id}/answers`, { revision: 0, answers: ans.slice(0, 2) }).expect(200)).body;
    expect(saved.revision).toBe(1);

    // A second tab still holding revision 0 must not overwrite.
    const conflict = await api(st).put(`/attempts/${at.attempt.id}/answers`, { revision: 0, answers: ans.slice(2) }).expect(409);
    expect(conflict.body.error.code).toBe('ANSWER_SAVE_CONFLICT');
    expect(conflict.body.error.details.revision).toBe(1);
    expect(Object.keys(conflict.body.error.details.answers)).toHaveLength(2);

    // Malformed / foreign answers are rejected, and nothing is half-applied.
    expect((await api(st).put(`/attempts/${at.attempt.id}/answers`, { revision: 1, answers: [{ questionVersionId: qs[0].id, answer: { optionIds: ['not-an-option'] } }] }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await api(st).put(`/attempts/${at.attempt.id}/answers`, { revision: 1, answers: [{ questionVersionId: '00000000-0000-4000-8000-000000000000', answer: { value: 'TRUE' } }] }).expect(422)).body.error.code).toBe('QUESTION_VERSION_INVALID');
    expect((await api(st).get(`/attempts/${at.attempt.id}`).expect(200)).body.attempt.revision).toBe(1);

    // Clearing an answer with null; resume shows saved state.
    await api(st).put(`/attempts/${at.attempt.id}/answers`, { revision: 1, answers: [{ questionVersionId: ans[0].questionVersionId, answer: null }] }).expect(200);
    const resumed = (await api(st).get(`/attempts/${at.attempt.id}`).expect(200)).body;
    expect(resumed.revision ?? resumed.attempt.revision).toBe(2);
    expect(Object.keys(resumed.answers)).toEqual([ans[1].questionVersionId]);
  }, 90_000);

  it('grades on submit, is idempotent, freezes the attempt, and shows the review', async () => {
    const b = await buildAssessment();
    const c = await courseWith(b.assessmentId);
    const st = await enrol(c.batchId);
    const at = await startAttempt(st, b.assessmentId);
    const ans = answersFor(questionsOf(at), ['Pick A and C']); // 3 of 4 correct
    await api(st).put(`/attempts/${at.attempt.id}/answers`, { revision: 0, answers: ans }).expect(200);

    const [r1, r2] = await Promise.all([api(st).post(`/attempts/${at.attempt.id}/submit`), api(st).post(`/attempts/${at.attempt.id}/submit`)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r1.body.score).toMatchObject({ raw: 3, max: 4, percent: 75 });
    expect(r2.body.score).toEqual(r1.body.score);
    expect(r1.body.score.band).toBeNull(); // quiz: no band
    expect(await prisma.studentTimelineEvent.count({ where: { studentId: st.studentId, type: 'ASSESSMENT_COMPLETED' } })).toBe(1); // graded once

    const review = r1.body.review[0].questions as { prompt: { text: string }; correct: boolean; correctAnswer: unknown }[];
    expect(review.find((q) => q.prompt.text === 'Pick A and C')!.correct).toBe(false);
    expect(review.find((q) => q.prompt.text === 'Pick B')!.correct).toBe(true);
    expect(review.find((q) => q.prompt.text === 'The ___ is open')!.correctAnswer).toMatchObject({ accepted: ['library', 'the library'] });

    // Frozen: API and database both refuse late writes.
    expect((await api(st).put(`/attempts/${at.attempt.id}/answers`, { revision: 1, answers: ans }).expect(409)).body.error.code).toBe('ATTEMPT_ALREADY_SUBMITTED');
    await expect(prisma.$executeRawUnsafe(`UPDATE attempt_answers SET answer = '{"value":"FALSE"}' WHERE attempt_id = '${at.attempt.id}'::uuid`)).rejects.toThrow();
    // GET on a submitted attempt returns the result, not the paper.
    expect((await api(st).get(`/attempts/${at.attempt.id}`).expect(200)).body.result.score.percent).toBe(75);
  }, 90_000);

  it('hides the correct answers when the assessment says so', async () => {
    const b = await buildAssessment({ showAnswers: false });
    const c = await courseWith(b.assessmentId);
    const st = await enrol(c.batchId);
    const at = await startAttempt(st, b.assessmentId);
    const res = (await api(st).post(`/attempts/${at.attempt.id}/submit`).expect(200)).body;
    expect(res.review).toBeNull();
    expect(res.score.percent).toBe(0); // blank paper
  });

  it('enforces attempt limits and numbers attempts', async () => {
    const b = await buildAssessment({ maxAttempts: 2 });
    const c = await courseWith(b.assessmentId);
    const st = await enrol(c.batchId);
    for (const n of [1, 2]) {
      const at = await startAttempt(st, b.assessmentId);
      expect(at.attempt.attemptNumber).toBe(n);
      await api(st).post(`/attempts/${at.attempt.id}/submit`).expect(200);
    }
    const third = await api(st).post(`/assessments/${b.assessmentId}/start`).expect(409);
    expect(third.body.error.code).toBe('ATTEMPT_LIMIT_REACHED');
  }, 90_000);
});

describe('timing', () => {
  it('auto-submits a timed-out attempt using the saved answers, and refuses late writes', async () => {
    const b = await buildAssessment({ timeLimitMin: 30 });
    const c = await courseWith(b.assessmentId);
    const st = await enrol(c.batchId);
    const at = await startAttempt(st, b.assessmentId);
    expect(at.attempt.remainingSeconds).toBeGreaterThan(29 * 60);
    const ans = answersFor(questionsOf(at));
    await api(st).put(`/attempts/${at.attempt.id}/answers`, { revision: 0, answers: ans.slice(0, 2) }).expect(200); // 2 of 4 saved

    await prisma.assessmentAttempt.update({ where: { id: at.attempt.id }, data: { expiresAt: new Date(Date.now() - 60_000) } }); // past deadline + grace
    const late = await api(st).put(`/attempts/${at.attempt.id}/answers`, { revision: 1, answers: ans.slice(2) }).expect(409);
    expect(late.body.error.code).toBe('ATTEMPT_EXPIRED');
    const row = await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: at.attempt.id } });
    expect(row.status).toBe('AUTO_GRADED');
    expect(Number(row.percent)).toBe(50); // only what was saved before the deadline counts
  }, 90_000);

  it('a grace window accepts writes just after the deadline; the sweeper closes abandoned attempts', async () => {
    const b = await buildAssessment({ timeLimitMin: 30 });
    const c = await courseWith(b.assessmentId);
    const st = await enrol(c.batchId);
    const at = await startAttempt(st, b.assessmentId);
    await prisma.assessmentAttempt.update({ where: { id: at.attempt.id }, data: { expiresAt: new Date(Date.now() - 3_000) } }); // inside 15s grace
    await api(st).put(`/attempts/${at.attempt.id}/answers`, { revision: 0, answers: answersFor(questionsOf(at)).slice(0, 1) }).expect(200);

    await prisma.assessmentAttempt.update({ where: { id: at.attempt.id }, data: { expiresAt: new Date(Date.now() - 120_000) } });
    const swept = await app.get(AttemptsService).sweepExpired();
    expect(swept).toBeGreaterThanOrEqual(1);
    expect((await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: at.attempt.id } })).status).toBe('AUTO_GRADED');
  }, 90_000);

  it('starting again after a lapsed attempt closes it first and respects the limit', async () => {
    const b = await buildAssessment({ timeLimitMin: 30, maxAttempts: 1 });
    const c = await courseWith(b.assessmentId);
    const st = await enrol(c.batchId);
    const at = await startAttempt(st, b.assessmentId);
    await prisma.assessmentAttempt.update({ where: { id: at.attempt.id }, data: { expiresAt: new Date(Date.now() - 120_000) } });
    expect((await api(st).post(`/assessments/${b.assessmentId}/start`).expect(409)).body.error.code).toBe('ATTEMPT_LIMIT_REACHED');
    expect((await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: at.attempt.id } })).status).toBe('AUTO_GRADED');
  });
});

describe('access, unlocks and progress', () => {
  it('requires an enrollment that can open the linked lesson', async () => {
    const b = await buildAssessment();
    const c = await courseWith(b.assessmentId);
    const stranger = await createStudent(app, prisma);
    await as(stranger.session)(http(app).post(`/assessments/${b.assessmentId}/start`)).expect(404);

    // Unlinked non-diagnostic assessments are not available at all.
    const orphan = await buildAssessment();
    const st = await enrol(c.batchId);
    expect((await api(st).post(`/assessments/${orphan.assessmentId}/start`).expect(404)).body.error.code).toBe('ASSESSMENT_NOT_AVAILABLE');
  }, 90_000);

  it('completes the lesson only when the pass mark is met, and unlocks score-based content', async () => {
    const b = await buildAssessment({ passPercent: 70 });
    let gated = '';
    const c = await courseWith(b.assessmentId, async (sec, quizItem) => {
      gated = (await post(`/admin/sections/${sec}/items`, { title: 'Advanced lesson', contentType: 'TEXT', releaseType: 'SCORE_BASED', releaseValue: { requiredItemId: quizItem, minScorePercent: 70 } }).expect(201)).body.id;
    });
    const st = await enrol(c.batchId);
    expect((await api(st).get(`/content/${gated}`).expect(403)).body.error.code).toBe('CONTENT_LOCKED');

    // Fail (50%): lesson stays open, still locked.
    let at = await startAttempt(st, b.assessmentId);
    await api(st).put(`/attempts/${at.attempt.id}/answers`, { revision: 0, answers: answersFor(questionsOf(at), ['Pick B', 'The sky is blue']) }).expect(200);
    const fail = (await api(st).post(`/attempts/${at.attempt.id}/submit`).expect(200)).body;
    expect(fail.score).toMatchObject({ percent: 50, passed: false });
    expect(await prisma.contentProgress.count({ where: { enrollmentId: st.enrollmentId, contentItemId: c.quizItem, status: 'COMPLETED' } })).toBe(0);
    await api(st).get(`/content/${gated}`).expect(403);

    // The lesson page tells the UI what to offer.
    const open = (await api(st).get(`/content/${c.quizItem}`).expect(200)).body;
    expect(open.assessment).toMatchObject({ id: b.assessmentId, attemptsUsed: 1, inProgressAttemptId: null, bestPercent: 50 });

    // Pass (100%): completes the lesson, updates course progress, unlocks the gated lesson.
    at = await startAttempt(st, b.assessmentId);
    await api(st).put(`/attempts/${at.attempt.id}/answers`, { revision: 0, answers: answersFor(questionsOf(at)) }).expect(200);
    expect((await api(st).post(`/attempts/${at.attempt.id}/submit`).expect(200)).body.score).toMatchObject({ percent: 100, passed: true });
    expect(await prisma.contentProgress.count({ where: { enrollmentId: st.enrollmentId, contentItemId: c.quizItem, status: 'COMPLETED' } })).toBe(1);
    expect(Number((await prisma.enrollment.findUniqueOrThrow({ where: { id: st.enrollmentId } })).progressPercent)).toBe(50); // 1 of 2 required items
    await api(st).get(`/content/${gated}`).expect(200);
  }, 120_000);
});

describe('bands', () => {
  it('converts listening scores using the versioned table and keeps history when the table changes', async () => {
    const b = await buildAssessment({ type: 'LISTENING', skill: 'LISTENING' });
    const c = await courseWith(b.assessmentId);
    const st = await enrol(c.batchId);

    const run = async (wrong: string[]) => {
      const at = await startAttempt(st, b.assessmentId);
      await api(st).put(`/attempts/${at.attempt.id}/answers`, { revision: 0, answers: answersFor(questionsOf(at), wrong) }).expect(200);
      return (await api(st).post(`/attempts/${at.attempt.id}/submit`).expect(200)).body;
    };
    const first = await run(['Pick A and C']); // 3/4 -> scaled 30/40 -> 7.0
    expect(first.score).toMatchObject({ percent: 75, band: 7 });
    const perfect = await run([]); // 4/4 -> 40/40 -> 9.0
    expect(perfect.score.band).toBe(9);

    const skills = (await api(st).get('/me/skills').expect(200)).body;
    expect(skills.LISTENING).toMatchObject({ latest: 9, best: 9 });
    expect(skills.LISTENING.series.map((p: { band: number }) => p.band)).toEqual([7, 9]);
    expect(skills.READING.series).toEqual([]);

    // Academic team publishes a new table: past attempts keep their stored band.
    const flat = { testType: 'LISTENING', rows: [{ rawMin: 0, rawMax: 40, band: 5 }] };
    expect((await post('/admin/band-conversions', { testType: 'LISTENING', rows: [{ rawMin: 0, rawMax: 39, band: 5 }] }).expect(422)).body.error.details.rows).toContain('40');
    const saved = (await post('/admin/band-conversions', flat).expect(201)).body;
    expect(saved.version).toBeGreaterThanOrEqual(2);
    const history = (await api(st).get('/me/assessments/history').expect(200)).body as { band: number }[];
    expect(history.map((h) => h.band).sort()).toEqual([7, 9]);
    const after = await run([]);
    expect(after.score.band).toBe(5);

    // Restore the seeded table so other tests are unaffected.
    const tables = (await as(admin)(http(app).get('/admin/band-conversions')).expect(200)).body.LISTENING as { version: number; rows: { rawMin: number; rawMax: number; band: string }[] }[];
    const original = tables.find((t) => t.version === 1)!;
    await post('/admin/band-conversions', { testType: 'LISTENING', rows: original.rows.map((r) => ({ ...r, band: Number(r.band) })) }).expect(201);
  }, 150_000);

  it('new attempts use the newest published version; old attempts keep theirs', async () => {
    const b = await buildAssessment();
    const c = await courseWith(b.assessmentId);
    const st = await enrol(c.batchId);
    const a1 = await startAttempt(st, b.assessmentId);
    await api(st).post(`/attempts/${a1.attempt.id}/submit`).expect(200);

    const v2 = (await post(`/admin/assessments/${b.assessmentId}/versions`).expect(201)).body;
    await post(`/admin/assessment-versions/${v2.id}/publish`).expect(200);
    const a2 = await startAttempt(st, b.assessmentId);
    const rows = await prisma.assessmentAttempt.findMany({ where: { studentId: st.studentId, assessmentId: b.assessmentId }, orderBy: { attemptNumber: 'asc' } });
    expect(rows.map((r) => r.assessmentVersionId)).toEqual([b.versionId, v2.id]);
    expect(a2.attempt.attemptNumber).toBe(2);
  }, 90_000);
});
