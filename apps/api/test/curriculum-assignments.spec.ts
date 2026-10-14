import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { PASSWORD, Session, as, createOpenBatch, enrollStudent, http, login, loginAdmin, newCourse, uniq } from './helpers';

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

async function mentor(batchId: string | null) {
  const email = `mentor-${uniq()}@test.local`;
  const m = (await post('/admin/mentors', { email, displayName: 'Mentor ' + uniq(), password: PASSWORD }).expect(201)).body;
  if (batchId) await post(`/admin/batches/${batchId}/mentors`, { mentorId: m.id, mentorRole: 'MAIN' }).expect(201);
  return { id: m.id as string, session: await login(app, email) };
}

/** A fresh, published course with one text item, plus a fresh open batch bound to it. */
async function buildBatchWithContent() {
  const nc = await newCourse(app, admin, prisma, 1000);
  const sec = (await post(`/admin/course-versions/${nc.versionId}/sections`, { title: 'Reading' }).expect(201)).body.id as string;
  const item = (await post(`/admin/sections/${sec}/items`, { title: 'Skimming strategies', contentType: 'TEXT', metadata: { body: 'x' } }).expect(201)).body.id as string;
  await post(`/admin/course-versions/${nc.versionId}/publish`).expect(200);
  const batchId = await createOpenBatch(app, admin);
  return { itemId: item, batchId };
}

describe('teacher curriculum assignment', () => {
  it('browsing and assigning are scoped to the teacher\'s own batch', async () => {
    const { itemId, batchId } = await buildBatchWithContent();
    const otherBatchId = await createOpenBatch(app, admin);
    const main = await mentor(batchId);
    const outsider = await mentor(otherBatchId);

    await as(outsider.session)(http(app).get(`/mentor/batches/${batchId}/curriculum`)).expect(403);
    const tree = (await as(main.session)(http(app).get(`/mentor/batches/${batchId}/curriculum`)).expect(200)).body;
    expect(JSON.stringify(tree)).toContain('Skimming strategies');

    await as(outsider.session)(http(app).post('/mentor/curriculum-assignments')).send({ contentItemId: itemId, batchId, requirement: 'REQUIRED' }).expect(403);
    const row = (await as(main.session)(http(app).post('/mentor/curriculum-assignments')).send({ contentItemId: itemId, batchId, requirement: 'REQUIRED', instructions: 'Read before Thursday.' }).expect(201)).body;
    expect(row.batchId).toBe(batchId);
  }, 30_000);

  it('rejects an assignment targeting neither or both batch and student', async () => {
    const { itemId, batchId } = await buildBatchWithContent();
    const main = await mentor(batchId);
    const st = await enrollStudent(app, prisma, admin, batchId);

    await as(main.session)(http(app).post('/mentor/curriculum-assignments')).send({ contentItemId: itemId }).expect(422);
    await as(main.session)(http(app).post('/mentor/curriculum-assignments')).send({ contentItemId: itemId, batchId, studentId: st.studentId }).expect(422);
  });

  it('a batch-wide assignment reaches every enrolled student, never a different batch\'s students', async () => {
    const { itemId, batchId } = await buildBatchWithContent();
    const otherBatchId = await createOpenBatch(app, admin);
    const main = await mentor(batchId);
    const st1 = await enrollStudent(app, prisma, admin, batchId);
    const st2 = await enrollStudent(app, prisma, admin, batchId);
    const otherStudent = await enrollStudent(app, prisma, admin, otherBatchId);

    await as(main.session)(http(app).post('/mentor/curriculum-assignments')).send({ contentItemId: itemId, batchId, requirement: 'REQUIRED' }).expect(201);

    for (const st of [st1, st2]) {
      const mine = (await as(st.session)(http(app).get('/me/curriculum-assignments')).expect(200)).body;
      expect(mine).toHaveLength(1);
      expect(mine[0].contentItem.title).toBe('Skimming strategies');
    }
    expect((await as(otherStudent.session)(http(app).get('/me/curriculum-assignments')).expect(200)).body).toEqual([]);

    const list = (await as(main.session)(http(app).get(`/mentor/batches/${batchId}/curriculum-assignments`)).expect(200)).body;
    expect(list).toHaveLength(1);
  }, 30_000);

  it('a student-specific assignment reaches only that student, and can be removed', async () => {
    const { itemId, batchId } = await buildBatchWithContent();
    const main = await mentor(batchId);
    const st1 = await enrollStudent(app, prisma, admin, batchId);
    const st2 = await enrollStudent(app, prisma, admin, batchId);

    const row = (await as(main.session)(http(app).post('/mentor/curriculum-assignments')).send({ contentItemId: itemId, studentId: st1.studentId, requirement: 'RECOMMENDED' }).expect(201)).body;

    expect((await as(st1.session)(http(app).get('/me/curriculum-assignments')).expect(200)).body).toHaveLength(1);
    expect((await as(st2.session)(http(app).get('/me/curriculum-assignments')).expect(200)).body).toEqual([]);

    await as(main.session)(http(app).delete(`/mentor/curriculum-assignments/${row.id}`)).expect(204);
    expect((await as(st1.session)(http(app).get('/me/curriculum-assignments')).expect(200)).body).toEqual([]);
  }, 30_000);

  it('cannot target a student outside the teacher\'s own batches', async () => {
    const { itemId, batchId } = await buildBatchWithContent();
    const otherBatchId = await createOpenBatch(app, admin);
    const main = await mentor(batchId);
    const otherStudent = await enrollStudent(app, prisma, admin, otherBatchId);

    await as(main.session)(http(app).post('/mentor/curriculum-assignments')).send({ contentItemId: itemId, studentId: otherStudent.studentId, requirement: 'REQUIRED' }).expect(403);
  });
});
