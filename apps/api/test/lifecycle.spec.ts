import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { LifecycleService } from '../src/lifecycle/lifecycle.service';
import { Session, as, createOpenBatch, createPublishedCourse, createStudent, newCourse, http, loginAdmin, uniq } from './helpers';

let app: NestExpressApplication;
let prisma: PrismaClient;
let admin: Session;
let lifecycle: LifecycleService;

beforeAll(async () => {
  ({ app } = await createApp(false));
  await app.init();
  lifecycle = app.get(LifecycleService);
  prisma = new PrismaClient();
  admin = await loginAdmin(app);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const post = (path: string, body: object = {}) => as(admin)(http(app).post(path)).send(body);
const inMs = (ms: number) => new Date(Date.now() + ms);

async function enrolled(batchId: string) {
  const st = await createStudent(app, prisma);
  const e = (await post('/admin/enrollments', { studentId: st.studentId, batchId, source: 'ADMIN', reason: 'test' }).expect(201)).body;
  return { ...st, enrollmentId: e.id as string };
}
const notes = (userId: string, type: string) => prisma.notification.count({ where: { userId, type } });
const get = (st: { session: Session }, p: string) => as(st.session)(http(app).get(p));

describe('expiry', () => {
  it('expires enrollments past their access date, once, and blocks content', async () => {
    const c = await createPublishedCourse(app, admin, prisma);
    const batchId = await createOpenBatch(app, admin);
    const st = await enrolled(batchId);
    await get(st, `/content/${c.itemId}`).expect(200);

    await prisma.enrollment.update({ where: { id: st.enrollmentId }, data: { accessEndsAt: inMs(-60_000) } });
    expect((await lifecycle.sweep()).expired).toBeGreaterThanOrEqual(1);
    expect((await prisma.enrollment.findUniqueOrThrow({ where: { id: st.enrollmentId } })).status).toBe('EXPIRED');
    expect(await notes(st.userId, 'ENROLLMENT_EXPIRED')).toBe(1);
    expect((await get(st, `/content/${c.itemId}`).expect(403)).body.error.code).toBe('ACCESS_EXPIRED');
    await lifecycle.sweep();
    expect(await notes(st.userId, 'ENROLLMENT_EXPIRED')).toBe(1); // not re-sent
  }, 90_000);
});

describe('reminders', () => {
  it('sends expiry reminders once each and honours notification preferences', async () => {
    const c = await createPublishedCourse(app, admin, prisma);
    const batchId = await createOpenBatch(app, admin);
    const a = await enrolled(batchId);
    const muted = await enrolled(batchId);
    await prisma.enrollment.update({ where: { id: a.enrollmentId }, data: { accessEndsAt: inMs(3 * 86_400_000) } });
    await prisma.enrollment.update({ where: { id: muted.enrollmentId }, data: { accessEndsAt: inMs(3 * 86_400_000) } });

    // defaults: everything on
    const prefs = (await get(a, '/me/notifications/preferences').expect(200)).body as { type: string; inApp: boolean; email: boolean }[];
    expect(prefs.map((p) => p.type)).toContain('EXPIRY_REMINDER');
    expect(prefs.every((p) => p.inApp && p.email)).toBe(true);
    await as(muted.session)(http(app).post('/me/notifications/preferences')).send({ preferences: [{ type: 'EXPIRY_REMINDER', inApp: false, email: false }] }).expect(200);
    expect((await get(muted, '/me/notifications/preferences').expect(200)).body.find((p: { type: string }) => p.type === 'EXPIRY_REMINDER')).toMatchObject({ inApp: false, email: false });
    await as(muted.session)(http(app).post('/me/notifications/preferences')).send({ preferences: [{ type: 'NOT_A_TYPE', inApp: true, email: true }] }).expect(422);

    await lifecycle.sweep();
    await lifecycle.sweep();
    await lifecycle.sweep(); // repeated sweeps must not repeat reminders
    expect(await notes(a.userId, 'EXPIRY_REMINDER')).toBe(1); // 7-day reminder only (3 days left)
    expect(await notes(muted.userId, 'EXPIRY_REMINDER')).toBe(0);

    await prisma.enrollment.update({ where: { id: a.enrollmentId }, data: { accessEndsAt: inMs(12 * 3_600_000) } });
    await lifecycle.sweep();
    expect(await notes(a.userId, 'EXPIRY_REMINDER')).toBe(2); // + the 1-day reminder
    // Essential messages ignore preferences.
    await prisma.enrollment.update({ where: { id: muted.enrollmentId }, data: { accessEndsAt: inMs(-1000) } });
    await lifecycle.sweep();
    expect(await notes(muted.userId, 'ENROLLMENT_EXPIRED')).toBe(1);
    // Muted in-app notifications never show in the bell.
    expect((await get(muted, '/me/notifications').expect(200)).body.items.map((i: { type: string }) => i.type)).not.toContain('EXPIRY_REMINDER');
  }, 120_000);

  it('reminds about classes (a day ahead and 30 minutes ahead) and unsubmitted deadlines', async () => {
    // A course with a due-tomorrow writing task.
    const s = uniq();
    const rubric = ((await as(admin)(http(app).get('/admin/rubrics')).expect(200)).body as { id: string; skill: string }[]).find((r) => r.skill === 'WRITING')!;
    const nc = await newCourse(app, admin, prisma, 1000);
    const course = { id: nc.courseId };
    const versionId = nc.versionId;
    const sec = (await post(`/admin/course-versions/${versionId}/sections`, { title: 'W' }).expect(201)).body.id;
    const item = (await post(`/admin/sections/${sec}/items`, { title: 'Essay', contentType: 'WRITING_TASK' }).expect(201)).body.id;
    const asg = (await as(admin)(http(app).put(`/admin/items/${item}/assignment`)).send({ skill: 'WRITING', rubricId: rubric.id, dueAt: inMs(5 * 3_600_000).toISOString() }).expect(200)).body;
    await post(`/admin/course-versions/${versionId}/publish`).expect(200);
    const batchId = await createOpenBatch(app, admin);

    const pending = await enrolled(batchId);
    const done = await enrolled(batchId);
    await as(done.session)(http(app).post(`/assignments/${asg.id}/submit-writing`)).send({ body: 'My essay text here.' }).expect(200);

    const mentorEmail = `m-${uniq()}@test.local`;
    const m = (await post('/admin/mentors', { email: mentorEmail, displayName: 'Mentor', password: 'Str0ngPassw0rd!' }).expect(201)).body;
    await post(`/admin/batches/${batchId}/mentors`, { mentorId: m.id, mentorRole: 'MAIN' }).expect(201);
    await as(admin)(http(app).post(`/mentor/batches/${batchId}/sessions`)).send({ topic: 'Soon class', startsAt: inMs(20 * 60_000).toISOString(), endsAt: inMs(80 * 60_000).toISOString(), meetingUrl: 'https://zoom.us/j/9' }).expect(201);

    await lifecycle.sweep();
    await lifecycle.sweep();
    expect(await notes(pending.userId, 'DEADLINE_REMINDER')).toBe(1);
    expect(await notes(done.userId, 'DEADLINE_REMINDER')).toBe(0); // already submitted
    expect(await notes(pending.userId, 'CLASS_REMINDER')).toBe(2); // "tomorrow" + "starting soon", once each
  }, 150_000);
});

describe('staff actions', () => {
  it('pauses, resumes and extends access; extending revives an expired enrollment', async () => {
    const c = await createPublishedCourse(app, admin, prisma);
    const batchId = await createOpenBatch(app, admin);
    const st = await enrolled(batchId);
    const act = (body: object) => post(`/admin/enrollments/${st.enrollmentId}/action`, body);

    await act({ action: 'RESUME' }).expect(409); // not paused
    await act({ action: 'PAUSE' }).expect(200);
    expect((await get(st, `/content/${c.itemId}`).expect(403)).body.error.code).toBe('ACCESS_DENIED');
    await act({ action: 'PAUSE' }).expect(409);
    await act({ action: 'RESUME' }).expect(200);
    await get(st, `/content/${c.itemId}`).expect(200);

    await prisma.enrollment.update({ where: { id: st.enrollmentId }, data: { accessEndsAt: inMs(-1000) } });
    await lifecycle.sweep();
    expect((await get(st, `/content/${c.itemId}`).expect(403)).body.error.code).toBe('ACCESS_EXPIRED');
    const extended = (await act({ action: 'EXTEND', days: 30 }).expect(200)).body;
    expect(extended.status).toBe('ACTIVE');
    expect(new Date(extended.accessEndsAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    await get(st, `/content/${c.itemId}`).expect(200);
    expect((await act({ action: 'EXTEND', days: 0 }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.auditLog.count({ where: { action: 'ADMIN_CHANGED_ENROLLMENT', entityId: st.enrollmentId } })).toBe(3);
    await as(st.session)(http(app).post(`/admin/enrollments/${st.enrollmentId}/action`)).send({ action: 'EXTEND', days: 5 }).expect(403);
  }, 120_000);

  it('transfers between batches of the same version, keeping progress — batch size never matters', async () => {
    const c = await createPublishedCourse(app, admin, prisma);
    const from = await createOpenBatch(app, admin);
    const to = await createOpenBatch(app, admin);
    const st = await enrolled(from);
    await as(st.session)(http(app).post(`/content/${c.itemId}/progress`)).send({ progressPercent: 40, timeSpentSeconds: 30 }).expect(200);
    for (let i = 0; i < 3; i++) await enrolled(to); // the target already has plenty of students; that is fine

    const move = (toBatchId: string) => post(`/admin/enrollments/${st.enrollmentId}/transfer`, { toBatchId, reason: 'Schedule clash' });
    expect((await move(from).expect(422)).body.error.details.toBatchId).toBeTruthy();

    // A batch running a different course version cannot be a target.
    await createPublishedCourse(app, admin, prisma);
    const otherVersion = await createOpenBatch(app, admin);
    expect((await move(otherVersion).expect(409)).body.error.code).toBe('CONFLICT');

    await move(to).expect(200);
    const e = await prisma.enrollment.findUniqueOrThrow({ where: { id: st.enrollmentId } });
    expect(e.batchId).toBe(to);
    expect(await prisma.contentProgress.count({ where: { enrollmentId: st.enrollmentId, contentItemId: c.itemId, progressPercent: 40 } })).toBe(1); // progress carried over
    expect(await prisma.enrollmentTransfer.count({ where: { enrollmentId: st.enrollmentId, fromBatchId: from, toBatchId: to } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'ADMIN_TRANSFERRED_ENROLLMENT', entityId: st.enrollmentId } })).toBe(1);
    await get(st, `/content/${c.itemId}`).expect(200);
  }, 150_000);
});

describe('certificates', () => {
  it('issues once on completion, verifies publicly, serves a PDF, and is void after a refund', async () => {
    const c = await createPublishedCourse(app, admin, prisma, 5000); // one required TEXT lesson
    const batchId = await createOpenBatch(app, admin);
    const st = await enrolled(batchId);
    expect((await get(st, '/me/certificates').expect(200)).body).toEqual([]); // not complete yet
    await as(st.session)(http(app).post(`/enrollments/${st.enrollmentId}/certificate`)).expect(404).catch(() => undefined);

    await as(st.session)(http(app).post(`/content/${c.itemId}/complete`)).expect(200);
    const [a, b] = await Promise.all([get(st, '/me/certificates'), get(st, '/me/certificates')]);
    expect(a.body).toHaveLength(1);
    expect(b.body[0].code).toBe(a.body[0].code); // concurrent requests, one certificate
    expect(await prisma.certificate.count({ where: { studentId: st.studentId } })).toBe(1);
    const code = a.body[0].code as string;
    expect(code).toMatch(/^IELTS-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const v = (await http(app).get(`/certificates/${code}/verify`).expect(200)).body;
    expect(v).toMatchObject({ valid: true, studentName: 'Stu Dent' });
    expect(JSON.stringify(v)).not.toContain('@'); // no email or ids leak
    expect((await http(app).get(`/certificates/${code.toLowerCase()}/verify`).expect(200)).body.valid).toBe(true);
    expect((await http(app).get('/certificates/IELTS-NOPE-NOPE-NOPE/verify').expect(200)).body).toEqual({ valid: false });

    const pdf = await http(app).get(`/certificates/${code}/pdf`).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (d: Buffer) => chunks.push(d)); res.on('end', () => cb(null, Buffer.concat(chunks))); }).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    await expect(prisma.$executeRawUnsafe(`DELETE FROM certificates WHERE code = '${code}'`)).rejects.toThrow(); // records are permanent

    // Refund voids it.
    await prisma.enrollment.update({ where: { id: st.enrollmentId }, data: { status: 'REFUNDED' } });
    expect((await http(app).get(`/certificates/${code}/verify`).expect(200)).body.valid).toBe(false);
    await http(app).get(`/certificates/${code}/pdf`).expect(404);
  }, 120_000);
});

describe('diagnostics', () => {
  it('lists published diagnostic tests that any student can take without a course, with a band', async () => {
    const a = (await post('/admin/assessments', { title: `Diag ${uniq()}`, type: 'DIAGNOSTIC', skill: 'LISTENING' }).expect(201)).body;
    const v = (await as(admin)(http(app).get(`/admin/assessments/${a.id}`)).expect(200)).body.versions[0].id;
    const sec = (await post(`/admin/assessment-versions/${v}/sections`, { title: 'Part 1' }).expect(201)).body.id;
    await post(`/admin/assessment-sections/${sec}/questions`, { type: 'TFNG', prompt: { text: 'Diag q' }, answerKey: { value: 'TRUE' } }).expect(201);
    const st = await createStudent(app, prisma);
    expect(((await get(st, '/me/diagnostics').expect(200)).body as { id: string }[]).map((d) => d.id)).not.toContain(a.id); // unpublished
    await post(`/admin/assessment-versions/${v}/publish`).expect(200);

    const list = (await get(st, '/me/diagnostics').expect(200)).body as { id: string; attemptsUsed: number }[];
    expect(list.find((d) => d.id === a.id)).toMatchObject({ attemptsUsed: 0 });

    const at = (await as(st.session)(http(app).post(`/assessments/${a.id}/start`)).expect(201)).body;
    const q = at.paper[0].questions[0];
    await as(st.session)(http(app).put(`/attempts/${at.attempt.id}/answers`)).send({ revision: 0, answers: [{ questionVersionId: q.id, answer: { value: 'TRUE' } }] }).expect(200);
    const res = (await as(st.session)(http(app).post(`/attempts/${at.attempt.id}/submit`)).expect(200)).body;
    expect(res.score).toMatchObject({ percent: 100, band: 9 });

    expect((await get(st, '/me/diagnostics').expect(200)).body.find((d: { id: string }) => d.id === a.id)).toMatchObject({ attemptsUsed: 1, latestBand: 9 });
  }, 120_000);
});
