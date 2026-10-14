import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { Session, as, createOpenBatch, createStudent, enrollStudent, http, loginAdmin, newCourse, uniq } from './helpers';

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
const api = (st: { session: Session }) => ({
  get: (p: string) => as(st.session)(http(app).get(p)),
  post: (p: string, b: object = {}) => as(st.session)(http(app).post(p)).send(b),
  put: (p: string, b: object) => as(st.session)(http(app).put(p)).send(b),
  patch: (p: string, b: object) => as(st.session)(http(app).patch(p)).send(b),
  delete: (p: string) => as(st.session)(http(app).delete(p)),
});

interface PaperQ { id: string; prompt: { text: string }; options?: { id: string; label: string }[] }

/** A 4-question quiz, two of which get tagged with the same skillKey directly (skill-tagging via the
 *  admin API itself is not built yet; this simulates curriculum content that already carries the tag). */
async function buildTaggedQuiz(skillKey: string) {
  const a = (await post('/admin/assessments', { title: `Quiz ${uniq()}`, type: 'QUIZ' }).expect(201)).body;
  const versionId = (await as(admin)(http(app).get(`/admin/assessments/${a.id}`)).expect(200)).body.versions[0].id as string;
  const sectionId = (await post(`/admin/assessment-versions/${versionId}/sections`, { title: 'Part 1' }).expect(201)).body.id as string;
  const q = (body: object) => post(`/admin/assessment-sections/${sectionId}/questions`, body).expect(201);
  const q1 = (await q({ type: 'TFNG', prompt: { text: 'Q1' }, answerKey: { value: 'TRUE' } })).body;
  const q2 = (await q({ type: 'TFNG', prompt: { text: 'Q2' }, answerKey: { value: 'TRUE' } })).body;
  await q({ type: 'TFNG', prompt: { text: 'Q3' }, answerKey: { value: 'TRUE' } }); // untagged — must not count toward the skill
  await q({ type: 'TFNG', prompt: { text: 'Q4' }, answerKey: { value: 'TRUE' } }); // untagged
  await prisma.question.updateMany({ where: { id: { in: [q1.id, q2.id] } }, data: { skillKey, module: 'READING', track: 'BOTH' } });
  await post(`/admin/assessment-versions/${versionId}/publish`).expect(200);
  return { assessmentId: a.id as string };
}

async function courseWith(assessmentId: string) {
  const nc = await newCourse(app, admin, prisma, 1000);
  const sec = (await post(`/admin/course-versions/${nc.versionId}/sections`, { title: 'Reading' }).expect(201)).body.id as string;
  const quizItem = (await post(`/admin/sections/${sec}/items`, { title: 'The quiz', contentType: 'QUIZ', metadata: { assessmentId } }).expect(201)).body.id as string;
  await post(`/admin/course-versions/${nc.versionId}/publish`).expect(200);
  const batchId = await createOpenBatch(app, admin);
  return { quizItem, batchId };
}

describe('curriculum: skill states from real evidence', () => {
  it('derives a skill state only from questions tagged with that skill, correctly scoped per student', async () => {
    const skillKey = `reading.test_skill.${uniq()}`;
    const { assessmentId } = await buildTaggedQuiz(skillKey);
    const { batchId } = await courseWith(assessmentId);
    const st = await enrollStudent(app, prisma, admin, batchId);

    // Fresh student: UNKNOWN / absent until there is evidence.
    const before = (await api(st).get('/me/skill-states').expect(200)).body as Array<{ skillKey: string }>;
    expect(before.find((s) => s.skillKey === skillKey)).toBeUndefined();

    const started = (await api(st).post(`/assessments/${assessmentId}/start`).expect(201)).body;
    const questions = started.paper.flatMap((s: { questions: PaperQ[] }) => s.questions) as PaperQ[];
    // Answer Q1 correctly, Q2 incorrectly, Q3/Q4 correctly (untagged, must not affect the skill).
    const answers = questions.map((q) => ({ questionVersionId: q.id, answer: { value: q.prompt.text === 'Q2' ? 'FALSE' : 'TRUE' } }));
    await api(st).put(`/attempts/${started.attempt.id}/answers`, { revision: 0, answers }).expect(200);
    await api(st).post(`/attempts/${started.attempt.id}/submit`).expect(200);

    const after = (await api(st).get('/me/skill-states').expect(200)).body as Array<{ skillKey: string; state: string; accuracyPercent: number; sampleSize: number }>;
    const state = after.find((s) => s.skillKey === skillKey);
    expect(state).toBeDefined();
    expect(state!.sampleSize).toBe(2); // only the two tagged questions
    expect(state!.accuracyPercent).toBe(50);
    expect(state!.state).toBe('WEAK'); // <=50% accuracy

    // Persisted, not just computed on the fly.
    const row = await prisma.studentSkillState.findUnique({ where: { studentId_skillKey: { studentId: st.studentId, skillKey } } });
    expect(row).toMatchObject({ sampleSize: 2, state: 'WEAK' });
  }, 60_000);
});

describe("curriculum: today's workspace", () => {
  it('surfaces a teacher-assigned required item and a recommended one, each tagged with its source', async () => {
    const nc = await newCourse(app, admin, prisma, 1000);
    const sec = (await post(`/admin/course-versions/${nc.versionId}/sections`, { title: 'Writing' }).expect(201)).body.id as string;
    const requiredItem = (await post(`/admin/sections/${sec}/items`, { title: 'Required lesson', contentType: 'TEXT', metadata: { body: 'x' } }).expect(201)).body.id as string;
    const recommendedItem = (await post(`/admin/sections/${sec}/items`, { title: 'Recommended lesson', contentType: 'TEXT', metadata: { body: 'y' } }).expect(201)).body.id as string;
    const draftItem = (await post(`/admin/sections/${sec}/items`, { title: 'Draft lesson', contentType: 'TEXT', metadata: { body: 'z' } }).expect(201)).body.id as string;
    await post(`/admin/course-versions/${nc.versionId}/publish`).expect(200);
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    const teacher = await prisma.user.findFirstOrThrow({ where: { roles: { some: { role: { name: 'SUPER_ADMIN' } } } } });

    await prisma.curriculumAssignment.create({ data: { contentItemId: requiredItem, batchId, assignedBy: teacher.id, requirement: 'REQUIRED', publishedAt: new Date() } });
    await prisma.curriculumAssignment.create({ data: { contentItemId: recommendedItem, batchId, assignedBy: teacher.id, requirement: 'RECOMMENDED', publishedAt: new Date() } });
    // An unpublished (draft) assignment must never reach the student.
    await prisma.curriculumAssignment.create({ data: { contentItemId: draftItem, batchId, assignedBy: teacher.id, requirement: 'REQUIRED', publishedAt: null } });

    const today = (await api(st).get('/me/today').expect(200)).body;
    expect(today.requiredToday).toHaveLength(1);
    expect(today.requiredToday[0]).toMatchObject({ contentItemId: requiredItem, title: 'Required lesson', source: 'TEACHER_ASSIGNED' });
    expect(today.requiredToday[0].enrollmentId).toBeTruthy();
    expect(today.optionalAssigned).toHaveLength(1);
    expect(today.optionalAssigned[0]).toMatchObject({ contentItemId: recommendedItem, source: 'TEACHER_ASSIGNED' });
    expect(JSON.stringify(today)).not.toContain('Draft lesson');

    // Another student in a different batch never sees this one's assignments.
    const otherBatch = await createOpenBatch(app, admin);
    const other = await enrollStudent(app, prisma, admin, otherBatch);
    const otherToday = (await api(other).get('/me/today').expect(200)).body;
    expect(otherToday.requiredToday).toHaveLength(0);
  }, 60_000);

  it('requires a student account', async () => {
    await http(app).get('/me/today').expect(401);
  });
});

describe('study plan', () => {
  it('is CRUD, owned by the student, and marks a completion timestamp on DONE', async () => {
    const st1 = await createStudent(app, prisma);
    const st2 = await createStudent(app, prisma);
    const created = (await api(st1).post('/me/study-plan-items', { title: 'Review Part 3', plannedFor: '2027-01-15' }).expect(201)).body;
    expect(created.status).toBe('PLANNED');

    const list = (await api(st1).get('/me/study-plan-items').expect(200)).body as Array<{ id: string }>;
    expect(list.map((i) => i.id)).toContain(created.id);

    const done = (await api(st1).patch(`/me/study-plan-items/${created.id}`, { status: 'DONE' }).expect(200)).body;
    expect(done.status).toBe('DONE');
    expect(done.completedAt).not.toBeNull();

    // Another student cannot see, update or delete it.
    expect((await api(st2).get('/me/study-plan-items').expect(200)).body.find((i: { id: string }) => i.id === created.id)).toBeUndefined();
    await api(st2).patch(`/me/study-plan-items/${created.id}`, { title: 'hijack' }).expect(404);
    await api(st2).delete(`/me/study-plan-items/${created.id}`).expect(404);

    await api(st1).delete(`/me/study-plan-items/${created.id}`).expect(204);
    expect((await api(st1).get('/me/study-plan-items').expect(200)).body.find((i: { id: string }) => i.id === created.id)).toBeUndefined();
  });
});

// A free-form personal vocabulary/grammar notebook was proposed here, but this codebase already has
// a richer vocabulary (SRS review, curated catalog — src/vocabulary) and grammar (teacher-tagged
// categories — src/grammar) system, kept in its place; the notebook's routes were never built.

describe('insights', () => {
  it('surfaces a weak-skill insight only once there is enough evidence, never below the floor', async () => {
    const skillKey = `reading.weak_skill.${uniq()}`;
    const a = (await post('/admin/assessments', { title: `Quiz ${uniq()}`, type: 'QUIZ' }).expect(201)).body;
    const versionId = (await as(admin)(http(app).get(`/admin/assessments/${a.id}`)).expect(200)).body.versions[0].id as string;
    const sectionId = (await post(`/admin/assessment-versions/${versionId}/sections`, { title: 'Part 1' }).expect(201)).body.id as string;
    const q = (body: object) => post(`/admin/assessment-sections/${sectionId}/questions`, body).expect(201);
    const qs = [];
    for (let i = 0; i < 5; i++) qs.push((await q({ type: 'TFNG', prompt: { text: `Q${i}` }, answerKey: { value: 'TRUE' } })).body);
    await prisma.question.updateMany({ where: { id: { in: qs.map((x) => x.id) } }, data: { skillKey, module: 'READING', track: 'BOTH' } });
    await post(`/admin/assessment-versions/${versionId}/publish`).expect(200);

    const nc = await newCourse(app, admin, prisma, 1000);
    const sec = (await post(`/admin/course-versions/${nc.versionId}/sections`, { title: 'Reading' }).expect(201)).body.id as string;
    await post(`/admin/sections/${sec}/items`, { title: 'The quiz', contentType: 'QUIZ', metadata: { assessmentId: a.id } }).expect(201);
    await post(`/admin/course-versions/${nc.versionId}/publish`).expect(200);
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);

    // No evidence yet: no insight, not even a guess.
    expect((await api(st).get('/me/insights').expect(200)).body).toEqual([]);

    const started = (await api(st).post(`/assessments/${a.id}/start`).expect(201)).body;
    const questions = started.paper.flatMap((s: { questions: PaperQ[] }) => s.questions) as PaperQ[];
    // 1 correct, 4 wrong -> 20% accuracy, sample size 5 (right at the evidence floor).
    const answers = questions.map((qn) => ({ questionVersionId: qn.id, answer: { value: qn.prompt.text === 'Q0' ? 'TRUE' : 'FALSE' } }));
    await api(st).put(`/attempts/${started.attempt.id}/answers`, { revision: 0, answers }).expect(200);
    await api(st).post(`/attempts/${started.attempt.id}/submit`).expect(200);

    const insights = (await api(st).get('/me/insights').expect(200)).body as Array<{ kind: string; skillKey: string; accuracyPercent: number; sampleSize: number }>;
    const found = insights.find((i) => i.skillKey === skillKey);
    expect(found).toMatchObject({ kind: 'WEAK_SKILL', accuracyPercent: 20, sampleSize: 5 });
  }, 60_000);
});
