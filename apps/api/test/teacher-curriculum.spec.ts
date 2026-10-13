import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { PASSWORD, Session, as, createOpenBatch, createPublishedCourse, createStudent, enrollStudent, http, login, loginAdmin, uniq } from './helpers';

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
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

async function mentor(batchId: string | null) {
  const email = `mentor-${uniq()}@test.local`;
  const m = (await post('/admin/mentors', { email, displayName: 'Mentor ' + uniq(), password: PASSWORD }).expect(201)).body;
  if (batchId) await post(`/admin/batches/${batchId}/mentors`, { mentorId: m.id, mentorRole: 'MAIN' }).expect(201);
  return { id: m.id as string, session: await login(app, email) };
}

describe('teacher curriculum browse and assignment', () => {
  it('lets an authorised teacher assign a real curriculum item to their batch, and rejects an unauthorised one', async () => {
    // Freshly publishes the shared one-course academy's content, then creates batches against it,
    // so this test does not depend on what any other spec file has left as the "newest published
    // version" — a batch binds to the newest published version at the moment it is created (this
    // suite's shared course is a global, mutable fixture — see helpers.ts).
    const c = await createPublishedCourse(app, admin, prisma);
    const batchId = await createOpenBatch(app, admin);
    const otherBatchId = await createOpenBatch(app, admin);
    const main = await mentor(batchId);
    const outsider = await mentor(otherBatchId);
    const st = await enrollStudent(app, prisma, admin, batchId);
    const otherStudent = await enrollStudent(app, prisma, admin, otherBatchId);

    interface TreeSection { items: { id: string; title: string; teacherAssignable: boolean }[]; children: TreeSection[] }
    const tree = (await as(main.session)(http(app).get('/mentor/curriculum')).expect(200)).body as { sections: TreeSection[] };
    const flatten = (s: TreeSection): TreeSection['items'] => [...s.items, ...s.children.flatMap(flatten)];
    const allItems = tree.sections.flatMap(flatten);
    const lesson = allItems.find((i) => i.title === 'Welcome');
    expect(lesson?.id).toBe(c.itemId);

    // An unauthorised teacher cannot assign to a batch they are not assigned to.
    await as(outsider.session)(http(app).post('/mentor/curriculum-assignments')).send({ contentItemId: lesson!.id, batchId, requirement: 'REQUIRED', classification: 'HOMEWORK', publish: true }).expect(403);

    const assignment = (await as(main.session)(http(app).post('/mentor/curriculum-assignments')).send({
      contentItemId: lesson!.id, batchId, requirement: 'REQUIRED', classification: 'HOMEWORK', instructions: 'Finish before Thursday.', publish: true,
    }).expect(201)).body[0];
    expect(assignment.batchId).toBe(batchId);

    // The assigned student sees it in Today; a student in a different batch never does.
    const today = (await as(st.session)(http(app).get('/me/today')).expect(200)).body;
    expect(today.requiredToday.map((r: { contentItemId: string }) => r.contentItemId)).toContain(lesson!.id);
    const otherToday = (await as(otherStudent.session)(http(app).get('/me/today')).expect(200)).body;
    expect(otherToday.requiredToday).toEqual([]);

    // Completion counts reflect real progress.
    const list1 = (await as(main.session)(http(app).get(`/mentor/batches/${batchId}/curriculum-assignments`)).expect(200)).body;
    expect(list1[0]).toMatchObject({ completedCount: 0, studentCount: 1 });
    await as(st.session)(http(app).post(`/content/${lesson!.id}/complete`)).expect(200);
    const list2 = (await as(main.session)(http(app).get(`/mentor/batches/${batchId}/curriculum-assignments`)).expect(200)).body;
    expect(list2[0].completedCount).toBe(1);

    // The outsider cannot remove it; the authorised teacher can.
    await as(outsider.session)(http(app).delete(`/mentor/curriculum-assignments/${assignment.id}`)).expect(403);
    await as(main.session)(http(app).delete(`/mentor/curriculum-assignments/${assignment.id}`)).expect(204);
    expect(await prisma.curriculumAssignment.count({ where: { id: assignment.id } })).toBe(0);
  }, 30_000);

  it('refuses to assign an item a teacher is not allowed to assign', async () => {
    const batchId = await createOpenBatch(app, admin);
    const main = await mentor(batchId);
    const item = await prisma.contentItem.findFirstOrThrow({ where: { title: 'Reading strategies' } });
    await prisma.contentItem.update({ where: { id: item.id }, data: { teacherAssignable: false } });
    const res = await as(main.session)(http(app).post('/mentor/curriculum-assignments')).send({ contentItemId: item.id, batchId, requirement: 'REQUIRED', classification: 'GENERAL', publish: true }).expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    await prisma.contentItem.update({ where: { id: item.id }, data: { teacherAssignable: true } }); // restore for other tests
  });

  it('requires curriculum.assign and refuses a student account entirely', async () => {
    const st = await createStudent(app, prisma);
    await as(st.session)(http(app).get('/mentor/curriculum')).expect(403);
  });
});

describe('live session Zoom validation and application-recorded lifecycle', () => {
  it('rejects a non-Zoom host for a ZOOM-provider session, and drives the lifecycle only by explicit action', async () => {
    const batchId = await createOpenBatch(app, admin);
    const main = await mentor(batchId);
    const body = (over: object = {}) => ({ topic: 'Reading strategies', startsAt: inMs(3_600_000), endsAt: inMs(7_200_000), provider: 'ZOOM', meetingUrl: 'https://zoom.us/j/555', ...over });

    const bad = await as(main.session)(http(app).post(`/mentor/batches/${batchId}/sessions`)).send(body({ meetingUrl: 'https://meet.google.com/abc-defg-hij' })).expect(422);
    expect(bad.body.error.code).toBe('MEETING_INVALID_URL');

    const session = (await as(main.session)(http(app).post(`/mentor/batches/${batchId}/sessions`)).send(body()).expect(201)).body;
    expect(session.status).toBe('SCHEDULED');

    await as(main.session)(http(app).post(`/mentor/sessions/${session.id}/start`)).expect(200);
    expect((await prisma.liveSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('IN_PROGRESS');

    await as(main.session)(http(app).post(`/mentor/sessions/${session.id}/complete`)).expect(200);
    const done = await prisma.liveSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(done.status).toBe('COMPLETED');
    expect(done.completedAt).not.toBeNull();

    // A completed class cannot be started or cancelled again.
    await as(main.session)(http(app).post(`/mentor/sessions/${session.id}/start`)).expect(409);
    await as(main.session)(http(app).post(`/mentor/sessions/${session.id}/cancel`)).send({ reason: 'too late' }).expect(409);
  }, 30_000);

  it('cancels with a reason, and reschedule on an update is recorded', async () => {
    const batchId = await createOpenBatch(app, admin);
    const main = await mentor(batchId);
    const body = (over: object = {}) => ({ topic: 'Writing', startsAt: inMs(3_600_000), endsAt: inMs(7_200_000), ...over });
    const s = (await as(main.session)(http(app).post(`/mentor/batches/${batchId}/sessions`)).send(body()).expect(201)).body;
    await as(main.session)(http(app).post(`/mentor/sessions/${s.id}/cancel`)).send({ reason: 'Teacher unavailable' }).expect(200);
    const cancelled = await prisma.liveSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'Teacher unavailable' });

    const s2 = (await as(main.session)(http(app).post(`/mentor/batches/${batchId}/sessions`)).send(body({ topic: 'Writing 2' })).expect(201)).body;
    await as(main.session)(http(app).patch(`/mentor/sessions/${s2.id}`)).send({ startsAt: inMs(2 * 86_400_000), endsAt: inMs(2 * 86_400_000 + 3_600_000) }).expect(200);
    const rescheduled = await prisma.liveSession.findUniqueOrThrow({ where: { id: s2.id } });
    expect(rescheduled.status).toBe('RESCHEDULED');
    expect(rescheduled.rescheduledFromStartsAt).not.toBeNull();
  }, 30_000);

  it('finalizes attendance and marks a later edit as a correction in the audit log', async () => {
    const batchId = await createOpenBatch(app, admin);
    const main = await mentor(batchId);
    const st = await enrollStudent(app, prisma, admin, batchId);
    const s = (await as(main.session)(http(app).post(`/mentor/batches/${batchId}/sessions`)).send({ topic: 'Speaking', startsAt: inMs(-7_200_000), endsAt: inMs(-3_600_000) }).expect(201)).body;
    await as(main.session)(http(app).put(`/mentor/sessions/${s.id}/attendance`)).send({ records: [{ studentId: st.studentId, status: 'PRESENT' }] }).expect(200);
    await as(main.session)(http(app).post(`/mentor/sessions/${s.id}/attendance/finalize`)).expect(200);
    expect((await prisma.liveSession.findUniqueOrThrow({ where: { id: s.id } })).attendanceFinalizedAt).not.toBeNull();

    await as(main.session)(http(app).put(`/mentor/sessions/${s.id}/attendance`)).send({ records: [{ studentId: st.studentId, status: 'LATE', note: 'Joined 10 minutes late' }] }).expect(200);
    const correctionLog = await prisma.auditLog.findFirst({ where: { action: 'ATTENDANCE_CORRECTED_AFTER_FINALIZATION', entityId: s.id }, orderBy: { createdAt: 'desc' } });
    expect(correctionLog).toBeTruthy();
    expect((await prisma.attendance.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: s.id, studentId: st.studentId } } })).status).toBe('LATE');
  }, 30_000);
});
