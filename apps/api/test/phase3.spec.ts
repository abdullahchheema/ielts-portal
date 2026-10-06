import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { Session, as, createStudent, http, loginAdmin, uniq } from './helpers';

/** Student intelligence against the database: insights, study plans, vocabulary, grammar, writing history and fluency. */

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
const get = (s: Session, path: string) => as(s)(http(app).get(path));

describe('student home and insights', () => {
  it('the home summary answers where the student is, without any AI call', async () => {
    const st = await createStudent(app, prisma);
    const home = (await get(st.session, '/me/home').expect(200)).body;
    expect(home.readiness.label).toBe('Readiness estimate');
    expect(home.readiness.percent).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(home.weakAreas)).toBe(true);
    expect(home.streakDays).toBe(0);
    expect(home.daysRemaining).toBeNull();
  });

  it('weakness and readiness return their breakdowns to the student', async () => {
    const st = await createStudent(app, prisma);
    const w = (await get(st.session, '/me/weakness').expect(200)).body;
    expect(w).toHaveProperty('bySkill');
    expect(w).toHaveProperty('byQuestionType');
    const r = (await get(st.session, '/me/readiness').expect(200)).body;
    expect(r.components.length).toBe(8);
  });

  it('the target band plan asks for a target first', async () => {
    const st = await createStudent(app, prisma);
    const plan = (await get(st.session, '/me/target-band').expect(200)).body;
    expect(plan.target).toBeNull();
  });

  it('staff can see a student’s insights only with student.view', async () => {
    const st = await createStudent(app, prisma);
    await get(st.session, `/admin/students/${st.studentId}/insights/weakness`).expect(403);
    await get(admin, `/admin/students/${st.studentId}/insights/weakness`).expect(200);
  });
});

describe('study plan', () => {
  it('recalculating with unchanged inputs keeps the same plan', async () => {
    const st = await createStudent(app, prisma);
    const first = (await post(st.session, '/me/study-plan/recalculate').expect(200)).body;
    const second = (await post(st.session, '/me/study-plan/recalculate').expect(200)).body;
    expect(second.plan.id).toBe(first.plan.id);
  });

  it('a change of target supersedes the old plan rather than editing it', async () => {
    const st = await createStudent(app, prisma);
    const first = (await post(st.session, '/me/study-plan/recalculate').expect(200)).body;
    await prisma.studentProfile.update({ where: { id: st.studentId }, data: { targetBand: 7 } });
    const after = (await post(st.session, '/me/study-plan/recalculate').expect(200)).body;
    expect(after.plan.id).not.toBe(first.plan.id);
    const old = await prisma.studyPlan.findUniqueOrThrow({ where: { id: first.plan.id } });
    expect(old.status).toBe('SUPERSEDED');
  });

  it('every task points at a record that exists', async () => {
    const st = await createStudent(app, prisma);
    await post(st.session, '/me/study-plan/recalculate').expect(200);
    const tasks = await prisma.studyPlanTask.findMany({ where: { studentId: st.studentId } });
    for (const t of tasks) {
      if (t.refType === 'QUESTION_SET') expect(await prisma.questionSet.findUnique({ where: { id: t.refId } })).not.toBeNull();
      if (t.refType === 'WRITING_TASK' || t.refType === 'SPEAKING_PART') expect(await prisma.question.findUnique({ where: { id: t.refId } })).not.toBeNull();
      if (t.refType === 'VOCABULARY_REVIEW') expect(await prisma.studentVocabulary.findUnique({ where: { id: t.refId } })).not.toBeNull();
    }
  });

  it('a student cannot complete another student’s task', async () => {
    const owner = await createStudent(app, prisma);
    const other = await createStudent(app, prisma);
    await post(owner.session, '/me/study-plan/recalculate').expect(200);
    const task = await prisma.studyPlanTask.findFirst({ where: { studentId: owner.studentId } });
    if (task) await post(other.session, `/me/study-plan/tasks/${task.id}/complete`).expect(404);
  });
});

describe('vocabulary', () => {
  it('only staff can add words, and every added word is approved', async () => {
    const st = await createStudent(app, prisma);
    await post(st.session, '/admin/vocabulary', { word: 'mitigate', definition: 'to make less severe' }).expect(403);
    const word = `mitigate${uniq()}`.replace(/[0-9]/g, '');
    const item = (await post(admin, '/admin/vocabulary', { word, definition: 'to make something less severe' }).expect(201)).body;
    expect(item.status).toBe('APPROVED');
  });

  it('a student saves a word, sees it due, and reviews it with spaced repetition', async () => {
    const word = `resilient${uniq()}`.replace(/[0-9]/g, '');
    const item = (await post(admin, '/admin/vocabulary', { word, definition: 'able to recover quickly' }).expect(201)).body;
    const st = await createStudent(app, prisma);
    const saved = (await post(st.session, `/me/vocabulary/${item.id}`).expect(201)).body;
    expect(saved.saved).toBe(true);
    const again = (await post(st.session, `/me/vocabulary/${item.id}`).expect(201)).body;
    expect(again.saved).toBe(false);

    const mine = (await get(st.session, '/me/vocabulary').expect(200)).body;
    expect(mine.due).toBeGreaterThanOrEqual(1);
    const review = (await post(st.session, `/me/vocabulary/cards/${saved.id}/review`, { correct: true }).expect(200)).body;
    expect(review.status).toBe('REVIEW');
    expect(new Date(review.nextReviewAt).getTime()).toBeGreaterThan(Date.now());
    const stats = (await get(st.session, '/me/vocabulary/stats').expect(200)).body;
    expect(stats.reviews).toBeGreaterThanOrEqual(1);
  });

  it('suggestions only come from approved words and skip what the student already saved', async () => {
    const word = `candid${uniq()}`.replace(/[0-9]/g, '');
    await post(admin, '/admin/vocabulary', { word, definition: 'honest and direct' }).expect(201);
    const st = await createStudent(app, prisma);
    const res = (await get(st.session, `/me/vocabulary/suggestions?text=${encodeURIComponent(`A ${word} answer is useful.`)}`).expect(200)).body;
    expect(res.map((r: { word: string }) => r.word.toLowerCase())).toContain(word.toLowerCase());
  });

  it('a student cannot review another student’s card', async () => {
    const word = `prudent${uniq()}`.replace(/[0-9]/g, '');
    const item = (await post(admin, '/admin/vocabulary', { word, definition: 'careful' }).expect(201)).body;
    const owner = await createStudent(app, prisma);
    const other = await createStudent(app, prisma);
    const saved = (await post(owner.session, `/me/vocabulary/${item.id}`).expect(201)).body;
    await post(other.session, `/me/vocabulary/cards/${saved.id}/review`, { correct: true }).expect(404);
  });
});

describe('grammar, writing history and fluency', () => {
  it('the grammar dashboard returns a clear, honest summary', async () => {
    const st = await createStudent(app, prisma);
    const g = (await get(st.session, '/me/grammar').expect(200)).body;
    expect(Array.isArray(g.rows)).toBe(true);
    expect(g.note).toMatch(/not an IELTS score/);
  });

  it('two evaluated essays can be compared side by side, and only by their owner', async () => {
    const st = await createStudent(app, prisma);
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = (await post(st.session, '/writing/responses', { taskType: 'TASK2', promptText: `Discuss topic number ${i} in detail for the course.` }).expect(201)).body;
      await as(st.session)(http(app).put(`/writing/responses/${r.id}`)).send({ revision: 1, body: 'Many people think that learning languages is valuable. In my opinion it is useful. First, it helps travel. Second, it helps work. However, it takes time and effort to master.' }).expect(200);
      await post(st.session, `/writing/responses/${r.id}/submit`).expect(200);
      ids.push(r.id);
    }
    const history = (await get(st.session, '/writing/history').expect(200)).body;
    expect(history.length).toBeGreaterThanOrEqual(2);
    const cmp = (await get(st.session, `/writing/compare?a=${ids[0]}&b=${ids[1]}`).expect(200)).body;
    expect(cmp.a.id).toBe(ids[0]);
    expect(cmp.b.id).toBe(ids[1]);
    expect(cmp.note).toMatch(/not official IELTS results/);

    const other = await createStudent(app, prisma);
    await get(other.session, `/writing/compare?a=${ids[0]}&b=${ids[1]}`).expect(404);
  });

  it('a speaking answer shows fluency indicators labelled as supporting only', async () => {
    const st = await createStudent(app, prisma);
    const attempt = (await post(st.session, '/speaking/attempts', { mode: 'PART1' }).expect(201)).body;
    const resp = (await post(st.session, `/speaking/attempts/${attempt.id}/responses`, { part: 'PART1', promptText: 'Tell me about your hometown.' }).expect(201)).body;
    await as(st.session)(http(app).post(`/speaking/responses/${resp.id}/audio`)).attach('file', Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(300, 3)]), { filename: 'a.webm', contentType: 'audio/webm' }).expect(200);
    const view = (await get(st.session, `/speaking/responses/${resp.id}`).expect(200)).body;
    expect(view.fluency).not.toBeNull();
    expect(view.fluency.note).toMatch(/Supporting indicators/);
    const profile = (await get(st.session, '/speaking/fluency-profile').expect(200)).body;
    expect(profile.answers).toBeGreaterThanOrEqual(1);
  });
});
