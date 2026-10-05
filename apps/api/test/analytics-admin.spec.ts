import type { NestExpressApplication } from '@nestjs/platform-express';
import * as argon2 from 'argon2';
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

/** A signed-in staff member holding exactly one seeded role. */
async function withRole(roleName: string): Promise<Session> {
  const email = `${roleName.toLowerCase()}-${uniq()}@test.local`;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  await prisma.user.create({
    data: {
      email, passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }), status: 'ACTIVE', emailVerifiedAt: new Date(),
      roles: { create: { roleId: role.id } },
    },
  });
  return login(app, email);
}

describe('admin analytics: who may see what', () => {
  it('a super admin gets the academy KPIs, the cohort and the needs-attention list', async () => {
    const batchId = await createOpenBatch(app, admin);
    await enrollStudent(app, prisma, admin, batchId);
    const kpis = (await as(admin)(http(app).get('/admin/analytics/kpis')).expect(200)).body;
    expect(kpis.risk.green + kpis.risk.yellow + kpis.risk.red).toBe(kpis.students.total);
    const list = (await as(admin)(http(app).get(`/admin/analytics/students?batchId=${batchId}`)).expect(200)).body;
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ level: 'GREEN', reasons: [] });
    expect(list.items[0].name).toBeTruthy();
    expect(list.items[0].email).toContain('@');
    const attention = (await as(admin)(http(app).get('/admin/analytics/needs-attention')).expect(200)).body;
    expect(attention.counts).toHaveProperty('red');
  });

  it('finance cannot read academic analytics, names or the export', async () => {
    const finance = await withRole('FINANCE_ADMIN');
    await as(finance)(http(app).get('/admin/analytics/kpis')).expect(403);
    await as(finance)(http(app).get('/admin/analytics/students')).expect(403);
    await as(finance)(http(app).get('/admin/analytics/needs-attention')).expect(403);
    await as(finance)(http(app).get('/admin/analytics/export/students.csv')).expect(403);
  });

  it('a teacher-role account cannot reach the admin analytics at all', async () => {
    const mentor = await withRole('MENTOR');
    await as(mentor)(http(app).get('/admin/analytics/kpis')).expect(403);
    await as(mentor)(http(app).get('/admin/analytics/students')).expect(403);
  });

  it('a student cannot reach any staff analytics', async () => {
    const batchId = await createOpenBatch(app, admin);
    const s = await enrollStudent(app, prisma, admin, batchId);
    await as(s.session)(http(app).get('/admin/analytics/students')).expect(403);
    await as(s.session)(http(app).get(`/admin/students/${s.studentId}/analytics`)).expect(403);
  });

  it('suppresses averages below the minimum group size instead of revealing individuals', async () => {
    const kpis = (await as(admin)(http(app).get('/admin/analytics/kpis')).expect(200)).body;
    if (kpis.attendance.measured < 3) expect(kpis.attendance.averagePercent).toBeNull();
    expect(typeof kpis.suppressed).toBe('boolean');
  });
});

describe('global search is sliced by permission', () => {
  it('returns students and batches to an admin, and nulls the sections the role may not see', async () => {
    const batchId = await createOpenBatch(app, admin);
    const s = await enrollStudent(app, prisma, admin, batchId);
    const first = (await prisma.studentProfile.findUniqueOrThrow({ where: { id: s.studentId }, select: { firstName: true } })).firstName;
    const full = (await as(admin)(http(app).get('/admin/search').query({ q: first.slice(0, 4) })).expect(200)).body;
    expect(Array.isArray(full.students)).toBe(true);
    const finance = await withRole('FINANCE_ADMIN');
    const limited = (await as(finance)(http(app).get('/admin/search').query({ q: first.slice(0, 4) })).expect(200)).body;
    expect(limited.students).toBeNull();
    expect(limited.batches).toBeNull();
  });
});

describe('admin analytics: export and student view', () => {
  it('exports a CSV with the same rows the list shows, as a download', async () => {
    const batchId = await createOpenBatch(app, admin);
    await enrollStudent(app, prisma, admin, batchId);
    const res = await as(admin)(http(app).get(`/admin/analytics/export/students.csv?batchId=${batchId}`)).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    const lines = res.text.replace('﻿', '').trim().split(/\r\n/);
    expect(lines[0]).toContain('name');
    expect(lines.length).toBe(2); // header + one student, matching the JSON list
    const json = (await as(admin)(http(app).get(`/admin/analytics/students?batchId=${batchId}`)).expect(200)).body;
    expect(lines.length - 1).toBe(json.total);
  });

  it('returns a student 360 analytics block with band and risk for an enrolled student', async () => {
    const batchId = await createOpenBatch(app, admin);
    const s = await enrollStudent(app, prisma, admin, batchId);
    const body = (await as(admin)(http(app).get(`/admin/students/${s.studentId}/analytics`)).expect(200)).body;
    expect(body.band.skills).toHaveProperty('WRITING');
    expect(body.band.overallStatus).toBe('INSUFFICIENT_DATA');
    expect(body.band.missingSkills.length).toBeGreaterThan(0);
    expect(body.risk.level).toBe('GREEN');
  });
});

describe('content analytics', () => {
  it('reports completion per course item and item analysis per question, and refuses finance', async () => {
    const version = await prisma.courseVersion.findFirstOrThrow({ where: { status: 'PUBLISHED' }, select: { id: true } });
    const courses = (await as(admin)(http(app).get(`/admin/analytics/courses/${version.id}`)).expect(200)).body;
    expect(Array.isArray(courses.items)).toBe(true);
    expect(courses.items.length).toBeGreaterThan(0);
    expect(courses.items[0]).toHaveProperty('completionPercent');
    const assessment = await prisma.assessment.findFirstOrThrow({ select: { id: true } });
    const questions = (await as(admin)(http(app).get(`/admin/analytics/questions?assessmentId=${assessment.id}`)).expect(200)).body;
    expect(Array.isArray(questions.questions)).toBe(true);
    for (const q of questions.questions) expect(q.medianTimeSeconds).toBeNull();
    const finance = await withRole('FINANCE_ADMIN');
    await as(finance)(http(app).get(`/admin/analytics/courses/${version.id}`)).expect(403);
    await as(finance)(http(app).get(`/admin/analytics/questions?assessmentId=${assessment.id}`)).expect(403);
  });
});
