import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { PASSWORD, Session, as, createOpenBatch, enrollStudent, http, login, loginAdmin, uniq } from './helpers';

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

describe('admin batch analytics', () => {
  it('computes attendance only over completed sessions, excludes pending-from-absent, and counts classes by status', async () => {
    const batchId = await createOpenBatch(app, admin);
    const main = await mentor(batchId);
    const s1 = await enrollStudent(app, prisma, admin, batchId);
    const s2 = await enrollStudent(app, prisma, admin, batchId);

    const mk = (topic: string, startOffsetMs: number) => as(main.session)(http(app).post(`/mentor/batches/${batchId}/sessions`))
      .send({ topic, startsAt: inMs(startOffsetMs), endsAt: inMs(startOffsetMs + 3_600_000) }).expect(201).then((r) => r.body.id as string);

    const completed1 = await mk('Done 1', -2 * 86_400_000);
    const completed2 = await mk('Done 2', -86_400_000);
    const cancelled = await mk('Cancelled class', -3_600_000);
    const future = await mk('Future class', 7 * 86_400_000);

    await as(main.session)(http(app).post(`/mentor/sessions/${completed1}/complete`)).expect(200);
    await as(main.session)(http(app).post(`/mentor/sessions/${completed2}/complete`)).expect(200);
    await as(main.session)(http(app).post(`/mentor/sessions/${cancelled}/cancel`)).send({ reason: 'weather' }).expect(200);

    // completed1: s1 present, s2 absent. completed2: s1 present, s2 has no row at all (pending).
    await as(main.session)(http(app).put(`/mentor/sessions/${completed1}/attendance`)).send({ records: [{ studentId: s1.studentId, status: 'PRESENT' }, { studentId: s2.studentId, status: 'ABSENT' }] }).expect(200);
    await as(main.session)(http(app).put(`/mentor/sessions/${completed2}/attendance`)).send({ records: [{ studentId: s1.studentId, status: 'PRESENT' }] }).expect(200);

    const a = (await as(admin)(http(app).get(`/admin/batches/${batchId}/analytics`)).expect(200)).body;
    expect(a.totalEnrolled).toBe(2);
    expect(a.classes).toEqual({ scheduled: 1, inProgress: 0, completed: 2, cancelled: 1 }); // future counted as scheduled; cancelled/future excluded from completed
    // 3 recorded rows total (s2's missing completed2 row is pending, not counted): 2 present, 1 absent -> 2/3
    expect(a.attendanceSampleSize).toBe(3);
    expect(a.averageAttendancePercent).toBeCloseTo((2 / 3) * 100, 1);
    // s2: 1 recorded (absent), 0 present/late -> 0% -> low attendance. s1: 2/2 present -> not low.
    expect(a.lowAttendanceStudents).toBe(1);
    void future; // referenced only to keep it in scope for readability
  }, 60_000);

  it('requires batch.analytics.view', async () => {
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    await as(st.session)(http(app).get(`/admin/batches/${batchId}/analytics`)).expect(403);
  });
});

describe('lecture recordings', () => {
  it('validates the Drive URL, scopes submission to assigned teachers, and only shows published recordings to students', async () => {
    const batchId = await createOpenBatch(app, admin);
    const otherBatchId = await createOpenBatch(app, admin);
    const main = await mentor(batchId);
    const outsider = await mentor(otherBatchId);
    const st = await enrollStudent(app, prisma, admin, batchId);

    const bad = await as(main.session)(http(app).post('/mentor/recordings')).send({ batchId, title: 'Class 1', driveUrl: 'https://dropbox.com/s/abc/video.mp4' }).expect(422);
    expect(bad.body.error.code).toBe('RECORDING_INVALID_URL');

    await as(outsider.session)(http(app).post('/mentor/recordings')).send({ batchId, title: 'Class 1', driveUrl: 'https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/view' }).expect(403);

    const rec = (await as(main.session)(http(app).post('/mentor/recordings')).send({
      batchId, title: 'Class 1 recording', driveUrl: 'https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/view',
    }).expect(201)).body;
    expect(rec.status).toBe('SUBMITTED');
    expect(rec.driveFileId).toBe('1A2B3C4D5E6F7G8H9I0J');

    // Not published yet: hidden from the student.
    expect((await as(st.session)(http(app).get('/me/recordings')).expect(200)).body).toEqual([]);

    await post(`/admin/recordings/${rec.id}/publish`).expect(200);
    const list = (await as(st.session)(http(app).get('/me/recordings')).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: rec.id, title: 'Class 1 recording', opened: false });

    await as(st.session)(http(app).post(`/me/recordings/${rec.id}/open`)).expect(200);
    const after = (await as(st.session)(http(app).get('/me/recordings')).expect(200)).body;
    expect(after[0].opened).toBe(true);

    // A student in a different (unrelated) batch never sees it.
    const otherStudent = await enrollStudent(app, prisma, admin, otherBatchId);
    expect((await as(otherStudent.session)(http(app).get('/me/recordings')).expect(200)).body).toEqual([]);

    // Admin can see it in the batch's recording list regardless of publication state.
    const adminList = (await as(admin)(http(app).get(`/admin/batches/${batchId}/recordings`)).expect(200)).body;
    expect(adminList.map((r: { id: string }) => r.id)).toContain(rec.id);
  }, 60_000);

  it('rejects a recording with a review note that the teacher can see', async () => {
    const batchId = await createOpenBatch(app, admin);
    const main = await mentor(batchId);
    const rec = (await as(main.session)(http(app).post('/mentor/recordings')).send({
      batchId, title: 'Blurry recording', driveUrl: 'https://drive.google.com/file/d/9Z8Y7X6W5V4U3T2S1R0Q/view',
    }).expect(201)).body;
    await post(`/admin/recordings/${rec.id}/reject`, { reviewNote: 'Audio is inaudible, please re-upload.' }).expect(200);
    const mine = (await as(main.session)(http(app).get('/mentor/recordings')).expect(200)).body as Array<{ id: string; status: string; reviewNote: string | null }>;
    const found = mine.find((r) => r.id === rec.id);
    expect(found).toMatchObject({ status: 'REJECTED', reviewNote: 'Audio is inaudible, please re-upload.' });
  });
});
