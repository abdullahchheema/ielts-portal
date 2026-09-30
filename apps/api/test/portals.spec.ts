import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { PASSWORD, Session, as, createOpenBatch, createStudent, enrollStudent, http, login, loginAdmin, uniq } from './helpers';

let app: NestExpressApplication;
let prisma: PrismaClient;
let admin: Session;
let teacher: Session;
let student: Awaited<ReturnType<typeof createStudent>>;
let assignedBatch: string;
let otherBatch: string;

beforeAll(async () => {
  ({ app } = await createApp(false));
  await app.init();
  prisma = new PrismaClient();
  admin = await loginAdmin(app);

  const email = `portal-teacher-${uniq()}@test.local`;
  const t = (await as(admin)(http(app).post('/admin/mentors')).send({ email, displayName: 'Portal Teacher', password: PASSWORD }).expect(201)).body;
  assignedBatch = await createOpenBatch(app, admin);
  otherBatch = await createOpenBatch(app, admin);
  await as(admin)(http(app).post(`/admin/batches/${assignedBatch}/mentors`)).send({ mentorId: t.id }).expect(201);
  teacher = await login(app, email);
  student = await createStudent(app, prisma);
}, 120_000);
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('sign-in works for every role with two-factor off', () => {
  it('logs in without a code and reports 2FA as disabled', async () => {
    for (const [email, password] of [['admin@test.local', 'TestAdminPass123'], [student.email, PASSWORD]] as const) {
      const res = await http(app).post('/auth/login').send({ email, password }).expect(200);
      expect(res.body.user.email).toBe(email);
    }
    const me = (await as(admin)(http(app).get('/auth/me')).expect(200)).body;
    expect(me).toMatchObject({ twoFactorEnabled: false, mfaSetupRequired: false });
    expect(me.roles).toContain('SUPER_ADMIN');
    const t = (await as(teacher)(http(app).get('/auth/me')).expect(200)).body;
    expect(t.roles).toContain('MENTOR');
    expect(t.mentorId).toBeTruthy();
    const s = (await as(student.session)(http(app).get('/auth/me')).expect(200)).body;
    expect(s.studentId).toBe(student.studentId);
  });
});

describe('student portal is for students only', () => {
  const studentEndpoints = ['/me/dashboard', '/me/enrollments', '/me/applications', '/me/profile', '/me/sessions'];

  it('lets a student in and keeps teachers and admins out of student-only endpoints', async () => {
    for (const p of studentEndpoints) await as(student.session)(http(app).get(p)).expect(200);
    for (const p of ['/me/dashboard', '/me/applications', '/me/enrollments']) {
      await as(teacher)(http(app).get(p)).expect(403);
      await as(admin)(http(app).get(p)).expect(403);
    }
  });

  it('refuses anonymous callers everywhere that is not public', async () => {
    for (const p of [...studentEndpoints, '/mentor/batches', '/admin/dashboard', '/admin/applications']) await http(app).get(p).expect(401);
    await http(app).get('/public/batches').expect(200);
  });
});

describe('teacher portal is limited to assigned batches', () => {
  it('blocks students from teacher endpoints', async () => {
    for (const p of ['/mentor/batches', '/mentor/dashboard', `/mentor/batches/${assignedBatch}/students`, `/mentor/batches/${assignedBatch}/results`]) {
      await as(student.session)(http(app).get(p)).expect(403);
    }
  });

  it('shows a teacher only their own batches, and their roster only after the payment is verified', async () => {
    const mine = (await as(teacher)(http(app).get('/mentor/batches')).expect(200)).body as { id: string }[];
    expect(mine.map((b) => b.id)).toEqual([assignedBatch]);

    await as(teacher)(http(app).get(`/mentor/batches/${otherBatch}/students`)).expect(403);
    await as(teacher)(http(app).get(`/mentor/batches/${otherBatch}/results`)).expect(403);
    await as(teacher)(http(app).get(`/mentor/batches/${otherBatch}/sessions`)).expect(403);

    const before = (await as(teacher)(http(app).get(`/mentor/batches/${assignedBatch}/students`)).expect(200)).body as unknown[];
    expect(before).toHaveLength(0);
    const enrolled = await enrollStudent(app, prisma, admin, assignedBatch);
    const roster = (await as(teacher)(http(app).get(`/mentor/batches/${assignedBatch}/students`)).expect(200)).body as { student: { id: string } }[];
    expect(roster.map((r) => r.student.id)).toEqual([enrolled.studentId]);
  }, 60_000);

  it('keeps teachers out of every admin endpoint', async () => {
    for (const p of ['/admin/dashboard', '/admin/applications', '/admin/students', '/admin/batches', '/admin/course', '/admin/settings', '/admin/staff', '/admin/audit-logs', '/admin/orders']) {
      await as(teacher)(http(app).get(p)).expect(403);
    }
    await as(teacher)(http(app).post('/admin/batches')).send({ name: 'nope', startAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(403);
  });
});

describe('admin portal', () => {
  it('is closed to students', async () => {
    for (const p of ['/admin/dashboard', '/admin/applications', '/admin/students', '/admin/batches', '/admin/course', '/admin/settings', '/admin/orders', '/admin/mentors']) {
      await as(student.session)(http(app).get(p)).expect(403);
    }
  });

  it('is open to an admin, who also sees the new dashboard numbers', async () => {
    for (const p of ['/admin/applications', '/admin/students', '/admin/batches', '/admin/course', '/admin/settings', '/admin/mentors', '/admin/orders']) {
      await as(admin)(http(app).get(p)).expect(200);
    }
    const d = (await as(admin)(http(app).get('/admin/dashboard')).expect(200)).body;
    for (const k of ['students', 'pendingApplications', 'enrolledStudents', 'activeBatches', 'upcomingBatches', 'teachers', 'pendingVerifications']) {
      expect(typeof d[k]).toBe('number');
    }
  });

  it('has exactly one course, and refuses to create another', async () => {
    const course = (await as(admin)(http(app).get('/admin/course')).expect(200)).body;
    expect(course.title).toBe('Complete IELTS Preparation');
    expect(await prisma.course.count({ where: { deletedAt: null, status: { not: 'ARCHIVED' } } })).toBe(1);
    const res = await as(admin)(http(app).post('/admin/courses')).send({ code: `X-${uniq()}`, title: 'Another course', slug: `another-${uniq()}`, price: 100 }).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});
