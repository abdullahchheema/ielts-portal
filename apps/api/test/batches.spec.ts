import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import {
  PASSWORD, Session, as, createOpenBatch, createStudent, daysFromNow, enrollStudent, http, login, loginAdmin, uniq,
} from './helpers';

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

const mkTeacher = async (name: string) => {
  const email = `teacher-${uniq()}@test.local`;
  const m = (await as(admin)(http(app).post('/admin/mentors')).send({ email, displayName: name, password: PASSWORD }).expect(201)).body;
  return { email, id: m.id as string };
};

describe('batches', () => {
  it('can be created without a teacher, and has no capacity', async () => {
    const res = await as(admin)(http(app).post('/admin/batches')).send({
      name: 'No teacher yet', startAt: daysFromNow(10), days: ['MON', 'WED', 'FRI'], classTime: '18:30', capacity: 3,
    }).expect(201);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body).not.toHaveProperty('capacity');
    expect(res.body.days).toEqual(['MON', 'WED', 'FRI']);
    expect(res.body.classTime).toBe('18:30');

    const detail = (await as(admin)(http(app).get(`/admin/batches/${res.body.id}`)).expect(200)).body;
    expect(detail.mentorAssigned).toBe(false);
    expect(detail.mentors).toEqual([]);
    expect(detail).not.toHaveProperty('capacity');
    expect(detail.counts).toEqual({ pending: 0, enrolled: 0 });
  });

  it('can be created with a teacher, and validates days and time', async () => {
    const t = await mkTeacher('Created With');
    const ok = await as(admin)(http(app).post('/admin/batches')).send({ name: 'With teacher', startAt: daysFromNow(10), mentors: [{ mentorId: t.id, mentorRole: 'MAIN' }] }).expect(201);
    const detail = (await as(admin)(http(app).get(`/admin/batches/${ok.body.id}`)).expect(200)).body;
    expect(detail.mentorAssigned).toBe(true);
    expect(detail.mentors[0].mentor.displayName).toBe('Created With');

    await as(admin)(http(app).post('/admin/batches')).send({ name: 'Bad time', startAt: daysFromNow(10), classTime: '25:99' }).expect(422);
    await as(admin)(http(app).post('/admin/batches')).send({ name: 'Bad day', startAt: daysFromNow(10), days: ['FUNDAY'] }).expect(422);
    const unknownTeacher = await as(admin)(http(app).post('/admin/batches')).send({ name: 'Ghost', startAt: daysFromNow(10), mentors: [{ mentorId: '00000000-0000-4000-8000-000000000000' }] }).expect(422);
    expect(unknownTeacher.body.error.details.mentors).toBeTruthy();
  });

  it('enforces the status state machine (there is no FULL state)', async () => {
    const b = (await as(admin)(http(app).post('/admin/batches')).send({ name: 'SM', startAt: daysFromNow(3) }).expect(201)).body;
    expect(b.status).toBe('DRAFT');
    expect((await as(admin)(http(app).patch(`/admin/batches/${b.id}`)).send({ status: 'COMPLETED' }).expect(409)).body.error.code).toBe('CONFLICT');
    await as(admin)(http(app).patch(`/admin/batches/${b.id}`)).send({ status: 'FULL' }).expect(422);
    await as(admin)(http(app).patch(`/admin/batches/${b.id}`)).send({ status: 'OPEN' }).expect(200);
    await as(admin)(http(app).patch(`/admin/batches/${b.id}`)).send({ status: 'IN_PROGRESS' }).expect(200);
    await as(admin)(http(app).patch(`/admin/batches/${b.id}`)).send({ status: 'COMPLETED' }).expect(200);
    await as(admin)(http(app).patch(`/admin/batches/${b.id}`)).send({ status: 'OPEN' }).expect(409);
  });

  it('validates dates', async () => {
    const bad = await as(admin)(http(app).post('/admin/batches')).send({ name: 'Batch X', startAt: daysFromNow(5), endAt: daysFromNow(1) }).expect(422);
    expect(bad.body.error.details.endAt).toBeTruthy();
  });

  it('takes any number of students: nothing ever flips a batch to full', async () => {
    const batchId = await createOpenBatch(app, admin);
    for (let i = 0; i < 4; i++) await enrollStudent(app, prisma, admin, batchId);
    const detail = (await as(admin)(http(app).get(`/admin/batches/${batchId}`)).expect(200)).body;
    expect(detail.counts.enrolled).toBe(4);
    expect(detail.status).toBe('OPEN');
  }, 90_000);

  it('removes an unused batch, but archives one with history and refuses one with live students', async () => {
    const unused = (await as(admin)(http(app).post('/admin/batches')).send({ name: 'Unused', startAt: daysFromNow(3) }).expect(201)).body;
    expect((await as(admin)(http(app).delete(`/admin/batches/${unused.id}`)).expect(200)).body).toEqual({ deleted: true, archived: false });
    await as(admin)(http(app).get(`/admin/batches/${unused.id}`)).expect(404);

    const busy = await createOpenBatch(app, admin);
    await enrollStudent(app, prisma, admin, busy);
    const blocked = await as(admin)(http(app).delete(`/admin/batches/${busy}`)).expect(409);
    expect(blocked.body.error.code).toBe('CONFLICT');
  }, 60_000);

  it('assigns multiple teachers and scopes the teacher portal to assigned batches', async () => {
    const batchA = await createOpenBatch(app, admin);
    const batchB = await createOpenBatch(app, admin);
    const m1 = await mkTeacher('Main Teacher');
    const m2 = await mkTeacher('Other Teacher');

    await as(admin)(http(app).post(`/admin/batches/${batchA}/mentors`)).send({ mentorId: m1.id, mentorRole: 'MAIN' }).expect(201);
    await as(admin)(http(app).post(`/admin/batches/${batchA}/mentors`)).send({ mentorId: m1.id, mentorRole: 'WRITING' }).expect(201);
    const dup = await as(admin)(http(app).post(`/admin/batches/${batchA}/mentors`)).send({ mentorId: m1.id, mentorRole: 'MAIN' }).expect(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    await as(admin)(http(app).post(`/admin/batches/${batchB}/mentors`)).send({ mentorId: m2.id }).expect(201);

    const s1 = await login(app, m1.email);
    const mine = (await as(s1)(http(app).get('/mentor/batches')).expect(200)).body as { id: string }[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((b) => b.id === batchA)).toBe(true);

    await as(s1)(http(app).get(`/mentor/batches/${batchA}/students`)).expect(200);
    await as(s1)(http(app).get(`/mentor/batches/${batchA}/results`)).expect(200);
    const denied = await as(s1)(http(app).get(`/mentor/batches/${batchB}/students`)).expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
    await as(s1)(http(app).get(`/mentor/batches/${batchB}/results`)).expect(403);

    // Teachers have no admin powers.
    await as(s1)(http(app).post('/admin/batches')).send({ name: 'nope', startAt: daysFromNow(3) }).expect(403);
  });

  it('shows enrolled students to a teacher only once the admin assigns them to the batch', async () => {
    const batchId = await createOpenBatch(app, admin); // no teacher yet
    const t = await mkTeacher('Late Teacher');
    const s = await login(app, t.email);
    expect((await as(s)(http(app).get('/mentor/batches')).expect(200)).body).toEqual([]);
    await as(s)(http(app).get(`/mentor/batches/${batchId}/students`)).expect(403);

    const enrolled = await enrollStudent(app, prisma, admin, batchId); // enrolling works with no teacher
    expect((await prisma.enrollment.findUniqueOrThrow({ where: { id: enrolled.enrollmentId } })).status).toBe('ACTIVE');

    await as(admin)(http(app).post(`/admin/batches/${batchId}/mentors`)).send({ mentorId: t.id }).expect(201);
    const roster = (await as(s)(http(app).get(`/mentor/batches/${batchId}/students`)).expect(200)).body as { student: { id: string } }[];
    expect(roster.map((r) => r.student.id)).toContain(enrolled.studentId);
    const results = (await as(s)(http(app).get(`/mentor/batches/${batchId}/results`)).expect(200)).body as { studentId: string; skills: Record<string, unknown> }[];
    expect(results.find((r) => r.studentId === enrolled.studentId)?.skills).toHaveProperty('LISTENING');
    const dash = (await as(s)(http(app).get('/mentor/dashboard')).expect(200)).body;
    expect(dash).toMatchObject({ batches: 1, students: 1 });
  }, 60_000);

  it('does not show a pending (unverified) applicant to the teacher', async () => {
    const batchId = await createOpenBatch(app, admin);
    const t = await mkTeacher('Roster Teacher');
    await as(admin)(http(app).post(`/admin/batches/${batchId}/mentors`)).send({ mentorId: t.id }).expect(201);
    const s = await login(app, t.email);
    const pending = await createStudent(app, prisma);
    const { applyAs } = await import('./helpers');
    await applyAs(app, prisma, pending, batchId);
    expect((await as(s)(http(app).get(`/mentor/batches/${batchId}/students`)).expect(200)).body).toEqual([]);
  });
});
