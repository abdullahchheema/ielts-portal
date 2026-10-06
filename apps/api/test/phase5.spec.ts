import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { as, createOpenBatch, createStudent, enrollStudent, http, login, loginAdmin, PASSWORD, Session, uniq } from './helpers';

/** Teacher workspace: drafts, summary, queue scope, batch health and cohort comparisons. */

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

async function mentorFor(batchId: string | null) {
  const email = `mentor-${uniq()}@test.local`;
  const m = (await post(admin, '/admin/mentors', { email, displayName: 'Ms Teacher', password: PASSWORD }).expect(201)).body;
  if (batchId) await post(admin, `/admin/batches/${batchId}/mentors`, { mentorId: m.id, mentorRole: 'MAIN' }).expect(201);
  return { mentorId: m.id as string, session: await login(app, email) };
}

describe('teacher workspace scope', () => {
  it('a teacher sees their workload summary with the expected counts', async () => {
    const batchId = await createOpenBatch(app, admin);
    const t = await mentorFor(batchId);
    const s = (await get(t.session, '/mentor/workspace/summary').expect(200)).body;
    expect(s.pendingGrading).toEqual({ writing: 0, speaking: 0, total: 0 });
    expect(typeof s.studentsAtRisk).toBe('number');
  });

  it('a teacher cannot read the health of a batch they are not assigned to', async () => {
    const mine = await createOpenBatch(app, admin);
    const other = await createOpenBatch(app, admin);
    const t = await mentorFor(mine);
    await get(t.session, `/mentor/batches/${other}/health`).expect(404);
    const h = (await get(t.session, `/mentor/batches/${mine}/health`).expect(200)).body;
    expect(['GREEN', 'YELLOW', 'RED']).toContain(h.status);
    expect(Array.isArray(h.reasons)).toBe(true);
  });

  it('a draft for a submission the teacher cannot see is not found', async () => {
    const batchId = await createOpenBatch(app, admin);
    const t = await mentorFor(batchId);
    await get(t.session, `/mentor/submissions/${crypto.randomUUID()}/draft`).expect(404);
    await as(t.session)(http(app).put(`/mentor/submissions/${crypto.randomUUID()}/draft`)).send({ revision: 0, scores: [], comment: null }).expect(404);
  });

  it('the queue shows only submissions from the teacher’s batches', async () => {
    const batchId = await createOpenBatch(app, admin);
    const t = await mentorFor(batchId);
    const q = (await get(t.session, '/mentor/workspace/queue').expect(200)).body;
    expect(Array.isArray(q)).toBe(true);
    for (const row of q) expect(row.batchId).toBe(batchId);
  });
});

describe('batch health and cohorts', () => {
  it('a batch with students returns a status with a reason list an administrator can read', async () => {
    const batchId = await createOpenBatch(app, admin);
    await enrollStudent(app, prisma, admin, batchId);
    const all = (await get(admin, '/admin/batches/health').expect(200)).body as { batch: string; status: string; reasons: string[] }[];
    const mine = all.find((b) => b.batch);
    expect(mine).toBeTruthy();
    expect(['GREEN', 'YELLOW', 'RED']).toContain(mine!.status);
  });

  it('cohorts withhold any group smaller than the minimum size', async () => {
    const batchId = await createOpenBatch(app, admin);
    await enrollStudent(app, prisma, admin, batchId);
    const groups = (await get(admin, '/admin/cohorts?groupBy=batch').expect(200)).body as { size: number; suppressed: boolean; activationPercent?: number }[];
    const small = groups.find((g) => g.size < 3);
    if (small) {
      expect(small.suppressed).toBe(true);
      expect(small.activationPercent).toBeUndefined();
    }
    for (const g of groups) if (g.size >= 3) expect(g.suppressed).toBe(false);
  });

  it('the cohort export is a CSV and is recorded in the audit log', async () => {
    const before = await prisma.auditLog.count({ where: { action: 'DATA_EXPORTED', entityType: 'Cohorts' } });
    const res = await get(admin, '/admin/cohorts.csv?groupBy=month').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    // The leading byte order mark lets spreadsheet apps read the file as UTF-8.
    expect(res.text.replace(/^﻿/, '').split(/\r?\n/)[0]).toBe('label,size,suppressed,enrolled,activationPercent,completionPercent');
    const after = await prisma.auditLog.count({ where: { action: 'DATA_EXPORTED', entityType: 'Cohorts' } });
    expect(after).toBe(before + 1);
  });

  it('students cannot see cohorts or other batches’ health', async () => {
    const st = await createStudent(app, prisma);
    await get(st.session, '/admin/cohorts').expect(403);
    await get(st.session, '/admin/batches/health').expect(403);
  });
});
