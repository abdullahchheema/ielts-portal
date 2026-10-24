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

  it('deletes a published set too — status is no longer a restriction', async () => {
    const published = await buildDraftSet();
    await post(`/admin/question-sets/${published}/status`, { status: 'APPROVED', studentFacing: false }).expect(200);
    await post(`/admin/question-sets/${published}/status`, { status: 'PUBLISHED', studentFacing: true }).expect(200);

    await post('/admin/question-sets/bulk/delete', { ids: [published] }).expect(200);
    const row = await prisma.questionSet.findUnique({ where: { id: published } });
    expect(row).toBeNull();
  });

  it('deletes a set whose questions were already copied into a free-test wrapper, without a raw FK crash', async () => {
    // Copies made by the free-test wrapper builder (QuestionBankService.copyIntoSection) keep a
    // sourceQuestionId pointer back to the bank question they came from (a blocking FK) — this is
    // the exact shape that used to surface as a raw Postgres error instead of a clean response.
    const listening = await buildDraftSet();
    await prisma.questionSet.update({ where: { id: listening }, data: { skill: 'LISTENING', status: 'PUBLISHED', studentFacing: true } });
    const reading = await buildDraftSet();
    await prisma.questionSet.update({ where: { id: reading }, data: { status: 'PUBLISHED', studentFacing: true } });

    let picked: string | null = null;
    for (let i = 0; i < 8 && !picked; i++) {
      const claim = (await http(app).post('/free-test/claim').expect(201)).body;
      const lead = await prisma.freeAssessmentLead.findUniqueOrThrow({ where: { id: claim.leadId }, include: { examAttempt: true } });
      const assessmentId = lead.examAttempt?.listeningAssessmentId;
      if (assessmentId) {
        const set = await prisma.questionSet.findFirst({ where: { wrapperAssessmentId: assessmentId }, select: { id: true } });
        if (set && [listening, reading].includes(set.id)) picked = set.id;
      }
    }
    expect(picked).not.toBeNull();

    // Confirm a copy with a live sourceQuestionId pointer actually exists before deleting, so this
    // test would have failed before the fix.
    const originalQuestionIds = (await prisma.question.findMany({ where: { questionSetId: picked! }, select: { id: true } })).map((q) => q.id);
    const copies = await prisma.question.findMany({ where: { sourceQuestionId: { in: originalQuestionIds } }, select: { id: true } });
    expect(copies.length).toBeGreaterThan(0);

    await post(`/admin/question-sets/${picked}/status`, { status: 'ARCHIVED', studentFacing: false }).expect(200);
    await post('/admin/question-sets/bulk/delete', { ids: [picked!] }).expect(200);
    expect(await prisma.questionSet.findUnique({ where: { id: picked! } })).toBeNull();

    // The copy itself must survive (a past free-test result stays intact) — only its lineage
    // pointer is cleared, not the row.
    const survivingCopies = await prisma.question.findMany({ where: { id: { in: copies.map((c) => c.id) } } });
    expect(survivingCopies).toHaveLength(copies.length);
    expect(survivingCopies.every((c) => c.sourceQuestionId === null)).toBe(true);
  }, 60_000);

  it('is all-or-nothing: a set still referenced by a mock exam aborts the whole delete, nothing partially applied', async () => {
    const deletable = await buildDraftSet();
    const listening = await buildDraftSet();
    await prisma.questionSet.update({ where: { id: listening }, data: { skill: 'LISTENING', status: 'PUBLISHED', studentFacing: true } });
    const reading = await buildDraftSet();
    await prisma.questionSet.update({ where: { id: reading }, data: { status: 'PUBLISHED', studentFacing: true } });
    // compose() rotates across every published module, not just these two, so read back the exact
    // set id it actually used rather than assuming it picked one of ours.
    const mockExam = (await post('/admin/mock-exams/compose', { title: `Bulk delete guard ${uniq()}` }).expect(201)).body;

    const res = await post('/admin/question-sets/bulk/delete', { ids: [deletable, mockExam.listeningSetId] });
    expect(res.status).toBe(409);

    // The otherwise-deletable set must still exist — the batch rolled back entirely.
    const kept = await get(`/admin/question-sets/${deletable}`);
    expect(kept.status).toBe(200);
  });
});
