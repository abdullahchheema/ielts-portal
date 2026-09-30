import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { PASSWORD, Session, as, createOpenBatch, createStudent, newCourse, http, login, loginAdmin, uniq } from './helpers';

let app: NestExpressApplication;
let prisma: PrismaClient;
let admin: Session;
let rubrics: { id: string; name: string; skill: string; criteria: { id: string; name: string }[] }[];

beforeAll(async () => {
  ({ app } = await createApp(false));
  await app.init();
  prisma = new PrismaClient();
  admin = await loginAdmin(app);
  rubrics = (await as(admin)(http(app).get('/admin/rubrics')).expect(200)).body;
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const post = (path: string, body: object = {}) => as(admin)(http(app).post(path)).send(body);
const put = (path: string, body: object) => as(admin)(http(app).put(path)).send(body);
const writingRubric = () => rubrics.find((r) => r.name === 'IELTS Writing Task 2')!;
const speakingRubric = () => rubrics.find((r) => r.skill === 'SPEAKING')!;

async function buildCourse() {
  const s = uniq();
  const nc = await newCourse(app, admin, prisma, 1000);
  const course = { id: nc.courseId };
  const versionId = nc.versionId;
  const sec = (await post(`/admin/course-versions/${versionId}/sections`, { title: 'Writing' }).expect(201)).body.id as string;
  const writingItem = (await post(`/admin/sections/${sec}/items`, { title: 'Task 2 essay', contentType: 'WRITING_TASK' }).expect(201)).body.id as string;
  const speakingItem = (await post(`/admin/sections/${sec}/items`, { title: 'Part 2 talk', contentType: 'SPEAKING_TASK' }).expect(201)).body.id as string;
  const textItem = (await post(`/admin/sections/${sec}/items`, { title: 'Welcome', contentType: 'TEXT' }).expect(201)).body.id as string;
  const w = (await put(`/admin/items/${writingItem}/assignment`, { skill: 'WRITING', rubricId: writingRubric().id, instructions: 'Write 250 words', minWords: 5 }).expect(200)).body;
  const sp = (await put(`/admin/items/${speakingItem}/assignment`, { skill: 'SPEAKING', rubricId: speakingRubric().id }).expect(200)).body;
  await post(`/admin/course-versions/${versionId}/publish`).expect(200);
  const batchId = await createOpenBatch(app, admin);
  return { courseId: course.id as string, versionId, batchId, writingItem, speakingItem, textItem, writing: w.id as string, speaking: sp.id as string };
}

async function mentor(name: string, batchId: string, role: 'MAIN' | 'WRITING' | 'SPEAKING' | null) {
  const email = `mentor-${uniq()}@test.local`;
  const m = (await post('/admin/mentors', { email, displayName: name, password: PASSWORD }).expect(201)).body;
  if (role) await post(`/admin/batches/${batchId}/mentors`, { mentorId: m.id, mentorRole: role }).expect(201);
  return { email, session: await login(app, email) };
}

async function enrolled(batchId: string) {
  const st = await createStudent(app, prisma);
  const e = (await post('/admin/enrollments', { studentId: st.studentId, batchId, source: 'ADMIN', reason: 'test' }).expect(201)).body;
  return { ...st, enrollmentId: e.id as string };
}
const as_ = (st: { session: Session }) => ({
  get: (p: string) => as(st.session)(http(app).get(p)),
  post: (p: string, b: object = {}) => as(st.session)(http(app).post(p)).send(b),
  put: (p: string, b: object) => as(st.session)(http(app).put(p)).send(b),
});

const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(200, 3)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]);
const ESSAY = 'Some people believe that technology improves education and I agree with this view.';

async function submittedEssay(c: Awaited<ReturnType<typeof buildCourse>>) {
  const st = await enrolled(c.batchId);
  await as_(st).put(`/assignments/${c.writing}/draft`, { body: ESSAY, revision: 0 }).expect(200);
  const sub = (await as_(st).post(`/assignments/${c.writing}/submit-writing`).expect(200)).body;
  return { st, sub };
}

const scores = (rub: { criteria: { id: string }[] }, values: number[], comment?: string) => rub.criteria.map((c, i) => ({ criterionId: c.id, score: values[i], comment }));

describe('assignment setup', () => {
  it('matches the rubric to the skill, refuses published versions, and needs content.manage', async () => {
    const c = await buildCourse();
    const s = uniq();
    const nc = await newCourse(app, admin, prisma, 1000);
    const course = { id: nc.courseId };
    const v = nc.versionId;
    const sec = (await post(`/admin/course-versions/${v}/sections`, { title: 'S' }).expect(201)).body.id;
    const item = (await post(`/admin/sections/${sec}/items`, { title: 'Essay', contentType: 'WRITING_TASK' }).expect(201)).body.id;
    const text = (await post(`/admin/sections/${sec}/items`, { title: 'Just text', contentType: 'TEXT' }).expect(201)).body.id;

    expect((await put(`/admin/items/${item}/assignment`, { skill: 'WRITING', rubricId: speakingRubric().id }).expect(422)).body.error.details.rubricId).toBeTruthy();
    expect((await put(`/admin/items/${text}/assignment`, { skill: 'WRITING', rubricId: writingRubric().id }).expect(422)).body.error.details.contentType).toBeTruthy();
    expect((await put(`/admin/items/${c.writingItem}/assignment`, { skill: 'WRITING', rubricId: writingRubric().id }).expect(409)).body.error.code).toBe('VERSION_PUBLISHED_IMMUTABLE');

    const st = await createStudent(app, prisma);
    await as(st.session)(http(app).put(`/admin/items/${item}/assignment`)).send({ skill: 'WRITING', rubricId: writingRubric().id }).expect(403);
  });
});

describe('student submissions', () => {
  it('autosaves writing with revisions, submits once, and completes the lesson', async () => {
    const c = await buildCourse();
    const st = await enrolled(c.batchId);
    const lesson = (await as_(st).get(`/content/${c.writingItem}`).expect(200)).body;
    expect(lesson.assignment).toMatchObject({ id: c.writing, skill: 'WRITING', minWords: 5 });
    expect(lesson.assignment.criteria).toEqual(writingRubric().criteria.map((x) => x.name));

    expect((await as_(st).put(`/assignments/${c.writing}/draft`, { body: 'Draft one', revision: 0 }).expect(200)).body.revision).toBe(1);
    const stale = await as_(st).put(`/assignments/${c.writing}/draft`, { body: 'Other tab', revision: 0 }).expect(409);
    expect(stale.body.error.code).toBe('ANSWER_SAVE_CONFLICT');
    expect(stale.body.error.details.body).toBe('Draft one');
    await as_(st).put(`/assignments/${c.writing}/draft`, { body: ESSAY, revision: 1 }).expect(200);
    expect((await as_(st).get(`/content/${c.writingItem}`).expect(200)).body.assignment.current).toMatchObject({ status: 'DRAFT', body: ESSAY, revision: 2 });

    const [a, b] = await Promise.all([as_(st).post(`/assignments/${c.writing}/submit-writing`), as_(st).post(`/assignments/${c.writing}/submit-writing`)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.id).toBe(b.body.id);
    expect(a.body.status).toBe('SUBMITTED');
    expect(a.body.wordCount).toBe(ESSAY.split(' ').length);
    expect(await prisma.submission.count({ where: { studentId: st.studentId, assignmentId: c.writing } })).toBe(1);
    expect(await prisma.contentProgress.count({ where: { enrollmentId: st.enrollmentId, contentItemId: c.writingItem, status: 'COMPLETED' } })).toBe(1);

    expect((await as_(st).put(`/assignments/${c.writing}/draft`, { body: 'more', revision: 3 }).expect(409)).body.error.code).toBe('ATTEMPT_ALREADY_SUBMITTED');
  }, 90_000);

  it('rejects empty writing and unrelated students, and wrong-skill submissions', async () => {
    const c = await buildCourse();
    const st = await enrolled(c.batchId);
    expect((await as_(st).post(`/assignments/${c.writing}/submit-writing`).expect(422)).body.error.code).toBe('SUBMISSION_INCOMPLETE');
    expect((await as_(st).post(`/assignments/${c.speaking}/submit-writing`).expect(422)).body.error.details.skill).toBeTruthy();
    const stranger = await createStudent(app, prisma);
    await as_(stranger).put(`/assignments/${c.writing}/draft`, { body: 'x', revision: 0 }).expect(404);
  });

  it('accepts real audio only, once per task, and serves it by signed URL', async () => {
    const c = await buildCourse();
    const st = await enrolled(c.batchId);
    const upload = (buf: Buffer, name = 'talk.webm') => as(st.session)(http(app).post(`/assignments/${c.speaking}/submit-audio`)).attach('file', buf, { filename: name, contentType: 'audio/webm' });
    expect((await upload(EXE).expect(415)).body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    const first = (await upload(WEBM).expect(200)).body;
    expect(first.status).toBe('SUBMITTED');
    expect(first.audioUrl).toMatch(/\/files\/local\?key=/);
    const again = (await upload(WEBM).expect(200)).body;
    expect(again.id).toBe(first.id);
    expect(await prisma.submission.count({ where: { studentId: st.studentId, assignmentId: c.speaking } })).toBe(1);
    const url = new URL(first.audioUrl);
    expect((await http(app).get(`${url.pathname}${url.search}`).expect(200)).headers['content-type']).toBe('audio/webm');
  }, 90_000);
});

describe('mentor grading', () => {
  it('shows mentors only their own batches and skills', async () => {
    const c = await buildCourse();
    const other = await buildCourse();
    const main = await mentor('Main', c.batchId, 'MAIN');
    const writer = await mentor('Writer', c.batchId, 'WRITING');
    const stranger = await mentor('Elsewhere', other.batchId, 'MAIN');
    const unassigned = await mentor('Nobody', c.batchId, null);

    const st = await enrolled(c.batchId);
    await as_(st).put(`/assignments/${c.writing}/draft`, { body: ESSAY, revision: 0 }).expect(200);
    const w = (await as_(st).post(`/assignments/${c.writing}/submit-writing`).expect(200)).body;
    const sp = (await as(st.session)(http(app).post(`/assignments/${c.speaking}/submit-audio`)).attach('file', WEBM, { filename: 'a.webm' }).expect(200)).body;

    const ids = async (m: { session: Session }) => ((await as(m.session)(http(app).get('/mentor/submissions')).expect(200)).body.items as { id: string }[]).map((i) => i.id);
    expect(await ids(main)).toEqual(expect.arrayContaining([w.id, sp.id]));
    expect(await ids(writer)).toContain(w.id);
    expect(await ids(writer)).not.toContain(sp.id); // WRITING mentor does not see speaking
    expect(await ids(stranger)).not.toContain(w.id);
    expect((await as(unassigned.session)(http(app).get('/mentor/submissions')).expect(200)).body.total).toBe(0);

    await as(stranger.session)(http(app).get(`/mentor/submissions/${w.id}`)).expect(404);
    await as(writer.session)(http(app).get(`/mentor/submissions/${sp.id}`)).expect(404);
    await as(stranger.session)(http(app).post(`/mentor/submissions/${w.id}/grade`).send({ revision: w.revision, scores: scores(writingRubric(), [6, 6, 6, 6]) })).expect(404);
    await as(st.session)(http(app).get('/mentor/submissions')).expect(403);

    expect((await as(admin)(http(app).get('/mentor/submissions')).expect(200)).body.total).toBeGreaterThanOrEqual(2); // academic oversight
    const detail = (await as(main.session)(http(app).get(`/mentor/submissions/${w.id}`)).expect(200)).body;
    expect(detail.body).toBe(ESSAY);
    expect(detail.rubric.criteria).toHaveLength(4);
    expect(detail.student.name).toContain('Stu');
  }, 150_000);

  it('validates scores, applies IELTS rounding, and stops two mentors grading at once', async () => {
    const c = await buildCourse();
    const m1 = await mentor('One', c.batchId, 'MAIN');
    const m2 = await mentor('Two', c.batchId, 'WRITING');
    const { st, sub } = await submittedEssay(c);
    const grade = (m: { session: Session }, body: object) => as(m.session)(http(app).post(`/mentor/submissions/${sub.id}/grade`)).send(body);
    const rub = writingRubric();

    expect((await grade(m1, { revision: sub.revision, scores: scores(rub, [6, 6, 6, 6]).slice(0, 3) }).expect(422)).body.error.details.scores).toContain('Score every criterion');
    expect((await grade(m1, { revision: sub.revision, scores: scores(rub, [6, 6, 6, 6.3]) }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await grade(m1, { revision: sub.revision, scores: [...scores(rub, [6, 6, 6, 6]), { criterionId: '00000000-0000-4000-8000-000000000000', score: 6 }] }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');

    // Same revision, simultaneous: exactly one wins.
    const [r1, r2] = await Promise.all([
      grade(m1, { revision: sub.revision, comment: 'Good structure.', scores: scores(rub, [6, 6, 6, 7], 'ok') }),
      grade(m2, { revision: sub.revision, scores: scores(rub, [5, 5, 5, 5]) }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const winner = r1.status === 200 ? r1 : r2;
    expect([r1, r2].find((r) => r.status === 409)!.body.error.code).toBe('CONFLICT');
    expect(await prisma.submissionFeedback.count({ where: { submissionId: sub.id } })).toBe(1);
    expect(winner.body.status).toBe('GRADED');
    const expectedBand = r1.status === 200 ? 6.5 : 5; // 6.25 -> 6.5 (rounds up); or the all-5s
    expect(winner.body.finalBand).toBe(expectedBand);

    // Student reads the feedback with named criteria.
    const seen = (await as_(st).get(`/submissions/${sub.id}`).expect(200)).body;
    expect(seen.status).toBe('GRADED');
    expect(seen.feedback[0].scores.map((s: { criterion: string }) => s.criterion)).toEqual(rub.criteria.map((x) => x.name));
    expect(seen.student).toBeUndefined();
    expect((await prisma.notification.count({ where: { userId: st.userId, type: 'SUBMISSION_GRADED' } }))).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'MENTOR_GRADED_SUBMISSION', entityId: sub.id } })).toBe(1);
  }, 150_000);

  it('keeps every grading as history when a mentor regrades, and grades are immutable in the database', async () => {
    const c = await buildCourse();
    const m = await mentor('Regrader', c.batchId, 'MAIN');
    const { st, sub } = await submittedEssay(c);
    const rub = writingRubric();
    const grade = (revision: number, values: number[]) => as(m.session)(http(app).post(`/mentor/submissions/${sub.id}/grade`)).send({ revision, scores: scores(rub, values) });

    const first = (await grade(sub.revision, [6, 6, 6, 6]).expect(200)).body;
    expect(first.finalBand).toBe(6);
    expect((await grade(sub.revision, [7, 7, 7, 7]).expect(409)).body.error.details.revision).toBe(first.revision); // stale
    const second = (await grade(first.revision, [7, 7, 6.5, 7]).expect(200)).body; // 6.875 -> 7
    expect(second.finalBand).toBe(7);
    expect(second.feedback.map((f: { finalBand: number }) => f.finalBand)).toEqual([7, 6]); // newest first, history kept
    expect(await prisma.auditLog.count({ where: { action: 'MENTOR_CHANGED_GRADE', entityId: sub.id } })).toBe(1);

    await expect(prisma.$executeRawUnsafe(`UPDATE submission_feedback SET final_band = 9 WHERE submission_id = '${sub.id}'::uuid`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`DELETE FROM rubric_scores WHERE submission_id = '${sub.id}'::uuid`)).rejects.toThrow();

    // Writing bands feed the student's skill history alongside test bands.
    const skills = (await as_(st).get('/me/skills').expect(200)).body;
    expect(skills.WRITING).toMatchObject({ latest: 7, best: 7 });
    expect(skills.WRITING.series.map((p: { band: number }) => p.band)).toEqual([6, 7].slice(1)); // one graded submission -> its current band
  }, 150_000);
});
