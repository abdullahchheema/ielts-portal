import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { Session, as, createOpenBatch, createStudent, enrollStudent, newCourse, daysFromNow, http, loginAdmin, uniq } from './helpers';

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

/** Listening: A(text) -> B(video, needs A) ; C(quiz, required)   Reading: D(text)   Writing: E(text, released in 30 days) */
async function buildCourse() {
  const s = uniq();
  const nc = await newCourse(app, admin, prisma, 1000);
  const course = { id: nc.courseId };
  const versionId = nc.versionId;
  const section = async (title: string) => (await post(`/admin/course-versions/${versionId}/sections`, { title }).expect(201)).body.id as string;
  const item = async (sectionId: string, body: object) => (await post(`/admin/sections/${sectionId}/items`, body).expect(201)).body.id as string;

  const listening = await section('Listening');
  const A = await item(listening, { title: 'A', contentType: 'TEXT', metadata: { body: 'Hello A' } });
  const B = await item(listening, { title: 'B', contentType: 'VIDEO', releaseType: 'PREREQUISITE', releaseValue: { requiredItemId: A }, metadata: { url: 'https://example.com/v' } });
  const C = await item(listening, { title: 'C', contentType: 'QUIZ' });
  const reading = await section('Reading');
  const D = await item(reading, { title: 'D', contentType: 'TEXT' });
  const writing = await section('Writing');
  const E = await item(writing, { title: 'E', contentType: 'TEXT', releaseType: 'BATCH_DATE', releaseValue: { date: daysFromNow(30) } });

  await post(`/admin/course-versions/${versionId}/publish`).expect(200);
  const batchId = await createOpenBatch(app, admin);
  return { courseId: course.id as string, versionId, batchId, A, B, C, D, E };
}

async function enrolled(batchId: string) {
  const st = await createStudent(app, prisma);
  const enrollment = (await post('/admin/enrollments', { studentId: st.studentId, batchId, source: 'ADMIN', reason: 'test' }).expect(201)).body;
  return { ...st, enrollmentId: enrollment.id as string };
}

const get = (st: { session: Session }, path: string) => as(st.session)(http(app).get(path));
const act = (st: { session: Session }, path: string, body: object = {}) => as(st.session)(http(app).post(path)).send(body);

describe('course access + release rules', () => {
  it('hides content from students who are not enrolled in that version', async () => {
    const c = await buildCourse();
    const stranger = await createStudent(app, prisma);
    const res = await get(stranger, `/content/${c.A}`).expect(404);
    expect(res.body.error.code).toBe('CONTENT_NOT_FOUND');
    await get(stranger, `/me/courses/${c.batchId}`).expect(404);
  });

  it('shows lock states and enforces prerequisites and release dates server-side', async () => {
    const c = await buildCourse();
    const st = await enrolled(c.batchId);

    const tree = (await get(st, `/me/courses/${st.enrollmentId}`).expect(200)).body;
    const items = new Map<string, { state: string; lock?: { code: string } }>(
      tree.sections.flatMap((s: { items: { id: string; state: string; lock?: { code: string } }[] }) => s.items.map((i) => [i.id, i])),
    );
    expect(items.get(c.A)!.state).toBe('NOT_STARTED');
    expect(items.get(c.B)!.state).toBe('LOCKED');
    expect(items.get(c.B)!.lock!.code).toBe('PREREQUISITE_REQUIRED');
    expect(items.get(c.E)!.lock!.code).toBe('CONTENT_NOT_RELEASED');

    // The server refuses even if the client ignores the lock.
    expect((await get(st, `/content/${c.B}`).expect(403)).body.error.code).toBe('PREREQUISITE_REQUIRED');
    expect((await act(st, `/content/${c.B}/complete`).expect(403)).body.error.code).toBe('PREREQUISITE_REQUIRED');
    const later = await get(st, `/content/${c.E}`).expect(403);
    expect(later.body.error.code).toBe('CONTENT_NOT_RELEASED');
    expect(later.body.error.details.availableAt).toBeTruthy();

    // Completing A unlocks B.
    const opened = (await get(st, `/content/${c.A}`).expect(200)).body;
    expect(opened.content.body).toBe('Hello A');
    await act(st, `/content/${c.A}/complete`).expect(200);
    const b = (await get(st, `/content/${c.B}`).expect(200)).body;
    expect(b.content.url).toBe('https://example.com/v');
  });

  it('cannot self-complete quizzes or tests', async () => {
    const c = await buildCourse();
    const st = await enrolled(c.batchId);
    const res = await act(st, `/content/${c.C}/complete`).expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('blocks expired, paused and unpublished access', async () => {
    const c = await buildCourse();
    const st = await enrolled(c.batchId);
    await get(st, `/content/${c.A}`).expect(200);

    await prisma.enrollment.update({ where: { id: st.enrollmentId }, data: { accessEndsAt: new Date(Date.now() - 1000) } });
    expect((await get(st, `/content/${c.A}`).expect(403)).body.error.code).toBe('ACCESS_EXPIRED');
    expect((await get(st, `/me/courses/${st.enrollmentId}`).expect(403)).body.error.code).toBe('ACCESS_EXPIRED');

    await prisma.enrollment.update({ where: { id: st.enrollmentId }, data: { accessEndsAt: new Date(Date.now() + 86_400_000), status: 'PAUSED' } });
    expect((await get(st, `/content/${c.A}`).expect(403)).body.error.code).toBe('ACCESS_DENIED');

    await prisma.enrollment.update({ where: { id: st.enrollmentId }, data: { status: 'ACTIVE' } });
    await get(st, `/content/${c.A}`).expect(200);
    await prisma.contentItem.update({ where: { id: c.A }, data: { status: 'ARCHIVED' } });
    expect((await get(st, `/content/${c.A}`).expect(404)).body.error.code).toBe('CONTENT_UNPUBLISHED');
  });

  it("never shows one student's progress to another", async () => {
    const c = await buildCourse();
    const a = await enrolled(c.batchId);
    const b = await enrolled(c.batchId);
    await act(a, `/content/${c.A}/complete`).expect(200);
    const tree = (await get(b, `/me/courses/${b.enrollmentId}`).expect(200)).body;
    const itemA = tree.sections.flatMap((s: { items: { id: string; state: string }[] }) => s.items).find((i: { id: string }) => i.id === c.A);
    expect(itemA.state).toBe('NOT_STARTED');
    await get(b, `/me/courses/${a.enrollmentId}`).expect(404);
  });
});

describe('progress tracking', () => {
  it('is monotonic, capped below 100 until completion, and time is bounded', async () => {
    const c = await buildCourse();
    const st = await enrolled(c.batchId);
    await act(st, `/content/${c.A}/start`).expect(200);
    await act(st, `/content/${c.A}/progress`, { progressPercent: 50, lastPosition: 120, timeSpentSeconds: 30 }).expect(200);
    await act(st, `/content/${c.A}/progress`, { progressPercent: 30, timeSpentSeconds: 20 }).expect(200); // regress attempt
    await act(st, `/content/${c.A}/progress`, { progressPercent: 100 }).expect(200); // cannot self-award 100
    const row = await prisma.contentProgress.findFirstOrThrow({ where: { enrollmentId: st.enrollmentId, contentItemId: c.A } });
    expect(row.status).toBe('IN_PROGRESS');
    expect(row.progressPercent).toBe(99);
    expect(row.lastPosition).toBe(120);
    expect(row.timeSpentSeconds).toBe(50);

    const big = await act(st, `/content/${c.A}/progress`, { timeSpentSeconds: 100_000 }).expect(422);
    expect(big.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('is idempotent and stays unique per (student, enrollment, item)', async () => {
    const c = await buildCourse();
    const st = await enrolled(c.batchId);
    await Promise.all([1, 2, 3].map(() => act(st, `/content/${c.A}/complete`).then((r) => expect(r.status).toBe(200))));
    expect(await prisma.contentProgress.count({ where: { enrollmentId: st.enrollmentId, contentItemId: c.A } })).toBe(1);
  });

  it('computes enrollment progress from required items and reports skill progress', async () => {
    const c = await buildCourse(); // required items: A, B, C, D, E  (5)
    const st = await enrolled(c.batchId);
    await act(st, `/content/${c.A}/complete`).expect(200);
    expect((await act(st, `/content/${c.B}/complete`).expect(200)).body.enrollmentProgressPercent).toBe(40);
    await act(st, `/content/${c.D}/complete`).expect(200);

    const dash = (await get(st, '/me/dashboard').expect(200)).body;
    expect(Number(dash.courses[0].progressPercent)).toBe(60);
    expect(dash.courses[0].skills.listening).toBe(66.67); // A,B done of A,B,C
    expect(dash.courses[0].skills.reading).toBe(100);
    expect(dash.courses[0].skills.writing).toBe(0);
    expect(dash.courses[0].skills.speaking).toBeNull(); // course has no speaking section
    expect(Number(dash.overallProgressPercent)).toBe(60);
  });

  it('marks the enrollment COMPLETED at 100% and keeps content readable', async () => {
    const s = uniq();
    const nc = await newCourse(app, admin, prisma, 1000);
    const course = { id: nc.courseId };
    const versionId = nc.versionId;
    const sec = (await post(`/admin/course-versions/${versionId}/sections`, { title: 'Only' }).expect(201)).body.id;
    const item = (await post(`/admin/sections/${sec}/items`, { title: 'One', contentType: 'TEXT' }).expect(201)).body.id;
    await post(`/admin/course-versions/${versionId}/publish`).expect(200);
    const batchId = await createOpenBatch(app, admin);
    const st = await enrolled(batchId);

    expect((await act(st, `/content/${item}/complete`).expect(200)).body.enrollmentProgressPercent).toBe(100);
    const e = await prisma.enrollment.findUniqueOrThrow({ where: { id: st.enrollmentId } });
    expect(e.status).toBe('COMPLETED');
    expect(e.completedAt).toBeTruthy();
    await get(st, `/content/${item}`).expect(200);
    expect(await prisma.studentTimelineEvent.count({ where: { studentId: st.studentId, type: 'COURSE_COMPLETED' } })).toBe(1);
  });
});

describe('student profile', () => {
  it('validates IELTS bands and saves onboarding data', async () => {
    const st = await createStudent(app, prisma);
    const bad = await as(st.session)(http(app).patch('/me/profile')).send({ targetBand: 6.3 }).expect(422);
    expect(bad.body.error.details.targetBand).toBeTruthy();
    await as(st.session)(http(app).patch('/me/profile')).send({ currentBand: 5.5, targetBand: 7, ieltsExamDate: '2027-01-15', academicOrGeneral: 'ACADEMIC' }).expect(200);
    const p = (await get(st, '/me/profile').expect(200)).body;
    expect(Number(p.currentBand)).toBe(5.5);
    expect(Number(p.targetBand)).toBe(7);
    expect(p.academicOrGeneral).toBe('ACADEMIC');
  });
});

describe('Academic/General track filtering', () => {
  it('shows everything until a track is chosen, then only BOTH plus the chosen track — and hides a whole subtree under a hidden parent', async () => {
    const nc = await newCourse(app, admin, prisma, 1000);
    const versionId = nc.versionId;
    const listening = (await post(`/admin/course-versions/${versionId}/sections`, { title: 'Listening', module: 'BOTH' }).expect(201)).body.id as string;
    const readingAcademic = (await post(`/admin/course-versions/${versionId}/sections`, { title: 'Reading (Academic)', module: 'ACADEMIC' }).expect(201)).body.id as string;
    const readingGeneral = (await post(`/admin/course-versions/${versionId}/sections`, { title: 'Reading (General)', module: 'GENERAL' }).expect(201)).body.id as string;
    // A BOTH-tagged child under an ACADEMIC-only parent: must not be promoted to the top level when the parent is hidden.
    const childUnderAcademic = (await post(`/admin/course-versions/${versionId}/sections`, { title: 'Academic sub-unit', parentSectionId: readingAcademic, module: 'BOTH' }).expect(201)).body.id as string;
    await post(`/admin/sections/${listening}/items`, { title: 'L1', contentType: 'TEXT', metadata: { body: 'x' } }).expect(201);
    await post(`/admin/sections/${readingAcademic}/items`, { title: 'RA1', contentType: 'TEXT', metadata: { body: 'x' } }).expect(201);
    await post(`/admin/sections/${readingGeneral}/items`, { title: 'RG1', contentType: 'TEXT', metadata: { body: 'x' } }).expect(201);
    await post(`/admin/sections/${childUnderAcademic}/items`, { title: 'Sub1', contentType: 'TEXT', metadata: { body: 'x' } }).expect(201);
    await post(`/admin/course-versions/${versionId}/publish`).expect(200);

    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    // The enrollment application defaults to ACADEMIC; clear it to exercise the "not chosen yet" state.
    await prisma.studentProfile.update({ where: { id: st.studentId }, data: { academicOrGeneral: null } });
    const titlesOf = (sections: Array<{ title: string; children: unknown[] }>): string[] => sections.flatMap((s) => [s.title, ...titlesOf(s.children as never)]);

    // No track chosen yet: everything visible, track is null.
    const before = (await as(st.session)(http(app).get(`/me/courses/${st.enrollmentId}`)).expect(200)).body;
    expect(before.track).toBeNull();
    expect(titlesOf(before.sections)).toEqual(expect.arrayContaining(['Listening', 'Reading (Academic)', 'Reading (General)', 'Academic sub-unit']));

    await as(st.session)(http(app).patch('/me/profile')).send({ academicOrGeneral: 'ACADEMIC' }).expect(200);
    const academic = (await as(st.session)(http(app).get(`/me/courses/${st.enrollmentId}`)).expect(200)).body;
    expect(academic.track).toBe('ACADEMIC');
    const academicTitles = titlesOf(academic.sections);
    expect(academicTitles).toEqual(expect.arrayContaining(['Listening', 'Reading (Academic)', 'Academic sub-unit']));
    expect(academicTitles).not.toContain('Reading (General)');

    await as(st.session)(http(app).patch('/me/profile')).send({ academicOrGeneral: 'GENERAL' }).expect(200);
    const general = (await as(st.session)(http(app).get(`/me/courses/${st.enrollmentId}`)).expect(200)).body;
    expect(general.track).toBe('GENERAL');
    const generalTitles = titlesOf(general.sections);
    expect(generalTitles).toEqual(expect.arrayContaining(['Listening', 'Reading (General)']));
    // Hidden because its parent (Academic-only) is hidden for a General-track student — not promoted to the root.
    expect(generalTitles).not.toContain('Reading (Academic)');
    expect(generalTitles).not.toContain('Academic sub-unit');
  }, 60_000);
});

describe('mastery vs. completion', () => {
  it('never masters from completion alone — only a score at or above the item\'s threshold does, and it is never un-mastered by a later lower score', async () => {
    const a = (await post('/admin/assessments', { title: `Quiz ${uniq()}`, type: 'QUIZ' }).expect(201)).body;
    const versionId = (await as(admin)(http(app).get(`/admin/assessments/${a.id}`)).expect(200)).body.versions[0].id as string;
    const sectionId = (await post(`/admin/assessment-versions/${versionId}/sections`, { title: 'Part 1' }).expect(201)).body.id as string;
    const q = (body: object) => post(`/admin/assessment-sections/${sectionId}/questions`, body).expect(201);
    await q({ type: 'TFNG', prompt: { text: 'Q1' }, answerKey: { value: 'TRUE' } });
    await q({ type: 'TFNG', prompt: { text: 'Q2' }, answerKey: { value: 'TRUE' } });
    await post(`/admin/assessment-versions/${versionId}/publish`).expect(200);

    const nc = await newCourse(app, admin, prisma, 1000);
    const sec = (await post(`/admin/course-versions/${nc.versionId}/sections`, { title: 'Reading' }).expect(201)).body.id as string;
    const quizItem = (await post(`/admin/sections/${sec}/items`, { title: 'The quiz', contentType: 'QUIZ', metadata: { assessmentId: a.id }, masteryPercent: 80 }).expect(201)).body.id as string;
    await post(`/admin/course-versions/${nc.versionId}/publish`).expect(200);
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    const stApi = { get: (p: string) => as(st.session)(http(app).get(p)), post: (p: string, b: object = {}) => as(st.session)(http(app).post(p)).send(b), put: (p: string, b: object) => as(st.session)(http(app).put(p)).send(b) };

    const findItem = (tree: { sections: Array<{ items: Array<{ id: string; mastered: boolean; masteryPercent: number | null; state: string }> }> }) =>
      tree.sections.flatMap((s) => s.items).find((i) => i.id === quizItem)!;

    async function attempt(correctCount: 0 | 1 | 2) {
      const started = (await stApi.post(`/assessments/${a.id}/start`).expect(201)).body;
      const questions = started.paper.flatMap((s: { questions: Array<{ id: string; prompt: { text: string } }> }) => s.questions);
      const answers = questions.map((qn: { id: string; prompt: { text: string } }, idx: number) => ({ questionVersionId: qn.id, answer: { value: idx < correctCount ? 'TRUE' : 'FALSE' } }));
      await stApi.put(`/attempts/${started.attempt.id}/answers`, { revision: 0, answers }).expect(200);
      await stApi.post(`/attempts/${started.attempt.id}/submit`).expect(200);
    }

    // 1 of 2 correct (50%) clears "passed" (passPercent defaults to 0) but not the 80% mastery bar: Completed, not Mastered.
    await attempt(1);
    const afterHalf = findItem((await stApi.get(`/me/courses/${st.enrollmentId}`)).body);
    expect(afterHalf.state).toBe('COMPLETED');
    expect(afterHalf.mastered).toBe(false);

    // 2 of 2 correct (100%) clears the 80% bar: Mastered.
    await attempt(2);
    const afterFull = findItem((await stApi.get(`/me/courses/${st.enrollmentId}`)).body);
    expect(afterFull.mastered).toBe(true);

    // A later 0% attempt must not un-master it.
    await attempt(0);
    const afterZero = findItem((await stApi.get(`/me/courses/${st.enrollmentId}`)).body);
    expect(afterZero.mastered).toBe(true);
    expect(afterZero.state).toBe('COMPLETED');
  }, 60_000);

  it('an item with no mastery threshold stays a plain Completed/Mastered=false item regardless of score', async () => {
    const a = (await post('/admin/assessments', { title: `Quiz ${uniq()}` , type: 'QUIZ' }).expect(201)).body;
    const versionId = (await as(admin)(http(app).get(`/admin/assessments/${a.id}`)).expect(200)).body.versions[0].id as string;
    const sectionId = (await post(`/admin/assessment-versions/${versionId}/sections`, { title: 'Part 1' }).expect(201)).body.id as string;
    await post(`/admin/assessment-sections/${sectionId}/questions`, { type: 'TFNG', prompt: { text: 'Q1' }, answerKey: { value: 'TRUE' } }).expect(201);
    await post(`/admin/assessment-versions/${versionId}/publish`).expect(200);

    const nc = await newCourse(app, admin, prisma, 1000);
    const sec = (await post(`/admin/course-versions/${nc.versionId}/sections`, { title: 'Reading' }).expect(201)).body.id as string;
    const quizItem = (await post(`/admin/sections/${sec}/items`, { title: 'The quiz', contentType: 'QUIZ', metadata: { assessmentId: a.id } }).expect(201)).body.id as string;
    await post(`/admin/course-versions/${nc.versionId}/publish`).expect(200);
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);

    const started = (await as(st.session)(http(app).post(`/assessments/${a.id}/start`)).expect(201)).body;
    const q0 = started.paper[0].questions[0];
    await as(st.session)(http(app).put(`/attempts/${started.attempt.id}/answers`)).send({ revision: 0, answers: [{ questionVersionId: q0.id, answer: { value: 'TRUE' } }] }).expect(200);
    await as(st.session)(http(app).post(`/attempts/${started.attempt.id}/submit`)).expect(200);

    const tree = (await as(st.session)(http(app).get(`/me/courses/${st.enrollmentId}`)).expect(200)).body;
    const item = tree.sections.flatMap((s: { items: Array<{ id: string; mastered: boolean; masteryPercent: number | null; state: string }> }) => s.items).find((i: { id: string }) => i.id === quizItem);
    expect(item).toMatchObject({ state: 'COMPLETED', mastered: false, masteryPercent: null });
  }, 60_000);
});
