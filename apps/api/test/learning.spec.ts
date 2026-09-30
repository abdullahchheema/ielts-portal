import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { Session, as, createOpenBatch, createStudent, newCourse, daysFromNow, http, loginAdmin, uniq } from './helpers';

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
