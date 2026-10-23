import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { Session, as, http, loginAdmin, uniq } from './helpers';

/** Phase 4: bulk status-change and bulk-delete on question-bank sets, each applied inside one
 *  all-or-nothing transaction reusing the same guards as the single-item endpoints. */

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
const get = (path: string) => as(admin)(http(app).get(path));

/** A DRAFT set with one valid, publishable TFNG question. */
async function buildDraftSet() {
  const set = (await post('/admin/question-sets', { title: `Bulk ${uniq()}`, skill: 'READING', difficulty: 3, topic: `bulk-${uniq()}`, studentFacing: false }).expect(201)).body;
  await post(`/admin/question-sets/${set.id}/questions`, { ieltsType: 'TFNG', prompt: { text: 'Q1' }, marks: 1, answerKey: { value: 'TRUE' } }).expect(201);
  return set.id as string;
}

/** A DRAFT set with no questions — fails the "at least one question" publish guard. */
async function buildEmptyDraftSet() {
  const set = (await post('/admin/question-sets', { title: `Bulk empty ${uniq()}`, skill: 'READING', difficulty: 3, topic: `bulk-${uniq()}`, studentFacing: false }).expect(201)).body;
  return set.id as string;
}

describe('question-bank bulk status', () => {
  it('bulk-publishes several draft sets in one call each, all succeeding together', async () => {
    const a = await buildDraftSet();
    const b = await buildDraftSet();
    await post('/admin/question-sets/bulk/status', { ids: [a, b], status: 'APPROVED', studentFacing: false }).expect(200);
    await post('/admin/question-sets/bulk/status', { ids: [a, b], status: 'PUBLISHED', studentFacing: true }).expect(200);

    const rows = await prisma.questionSet.findMany({ where: { id: { in: [a, b] } } });
    expect(rows.every((r) => r.status === 'PUBLISHED' && r.studentFacing)).toBe(true);
  });

  it('is all-or-nothing: one set that fails the publish guard aborts the whole batch', async () => {
    const ok = await buildDraftSet();
    const empty = await buildEmptyDraftSet();
    await post('/admin/question-sets/bulk/status', { ids: [ok, empty], status: 'APPROVED', studentFacing: false }).expect(200);

    const res = await post('/admin/question-sets/bulk/status', { ids: [ok, empty], status: 'PUBLISHED', studentFacing: true });
    expect(res.status).toBe(422);

    // Neither set was published, even though `ok` alone would have succeeded.
    const rows = await prisma.questionSet.findMany({ where: { id: { in: [ok, empty] } } });
    expect(rows.every((r) => r.status === 'APPROVED')).toBe(true);
  });

  it('archives (unpublishes) several published sets in one call', async () => {
    const a = await buildDraftSet();
    const b = await buildDraftSet();
    await post('/admin/question-sets/bulk/status', { ids: [a, b], status: 'APPROVED', studentFacing: false }).expect(200);
    await post('/admin/question-sets/bulk/status', { ids: [a, b], status: 'PUBLISHED', studentFacing: true }).expect(200);

    await post('/admin/question-sets/bulk/status', { ids: [a, b], status: 'ARCHIVED', studentFacing: false }).expect(200);
    const rows = await prisma.questionSet.findMany({ where: { id: { in: [a, b] } } });
    expect(rows.every((r) => r.status === 'ARCHIVED' && !r.studentFacing)).toBe(true);
  });
});

describe('question-bank bulk delete', () => {
  it('deletes several draft sets in one call', async () => {
    const a = await buildDraftSet();
    const b = await buildDraftSet();
    await post('/admin/question-sets/bulk/delete', { ids: [a, b] }).expect(200);
    const rows = await prisma.questionSet.findMany({ where: { id: { in: [a, b] } } });
    expect(rows).toHaveLength(0);
  });

  it('is all-or-nothing: a published set in the batch aborts the whole delete, nothing partially applied', async () => {
    const deletable = await buildDraftSet();
    const published = await buildDraftSet();
    await post(`/admin/question-sets/${published}/status`, { status: 'APPROVED', studentFacing: false }).expect(200);
    await post(`/admin/question-sets/${published}/status`, { status: 'PUBLISHED', studentFacing: true }).expect(200);

    const res = await post('/admin/question-sets/bulk/delete', { ids: [deletable, published] });
    expect(res.status).toBe(409);

    // The otherwise-deletable draft set must still exist — the batch rolled back entirely.
    const kept = await get(`/admin/question-sets/${deletable}`);
    expect(kept.status).toBe(200);
  });
});
