import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { Session, as, http, loginAdmin, uniq } from './helpers';

/**
 * Validates the real March 2025 Listening/Reading/Writing/Speaking content (authored as
 * `contentBlocks` so the student sees the original paper layout with inline inputs, matching the
 * owner's source PDFs) against the live bulk-import pipeline — the same endpoint the admin bulk
 * import page uses. Fails loudly if the schema or any question count ever drifts.
 */

let app: NestExpressApplication;
let prisma: PrismaClient;
let admin: Session;

beforeAll(async () => {
  ({ app } = await createApp(false));
  await app.init();
  prisma = new PrismaClient();
  admin = await loginAdmin(app);
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

const post = (path: string, body: object) => as(admin)(http(app).post(path)).send(body);
const randomPhone = () => `03${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;

describe('March 2025 content import', () => {
  it('imports clean (zero issues) and commits all 4 skills with the expected question counts', async () => {
    const payload = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/march-2025-import.json'), 'utf8'));

    const preview = (await post('/admin/question-sets/import/preview', payload).expect(200)).body;
    expect(preview.totalIssues, JSON.stringify(preview.sets.flatMap((s: { issues: unknown[] }) => s.issues))).toBe(0);
    expect(preview.sets.map((s: { title: string; questionCount: number }) => [s.title, s.questionCount])).toEqual([
      ['IELTS March 2025 — Listening Practice Test 1', 40],
      ['IELTS March 2025 — Reading Practice Test 1', 40],
      ['IELTS March 2025 — Writing Task 1 and Task 2', 2],
      ['IELTS Speaking Practice Test 1', 23],
    ]);

    const commit = (await post('/admin/question-sets/import/commit', payload).expect(201)).body;
    expect(commit.created).toHaveLength(4);

    const listeningId = commit.created.find((c: { title: string }) => c.title.includes('Listening')).setId;
    const listening = (await as(admin)(http(app).get(`/admin/question-sets/${listeningId}`)).expect(200)).body;
    expect(listening.stimulus.sections).toHaveLength(4);
    expect(listening.stimulus.sections.map((s: { contentBlocks?: unknown[] }) => s.contentBlocks?.length)).toEqual([8, 7, 7, 10]);
    // Part 1's two tables cover questions 1-10 via {{N}} placeholders only (no 'questions' blocks needed).
    const part1Table = listening.stimulus.sections[0].contentBlocks.find((b: { type: string }) => b.type === 'table');
    expect(part1Table.rows[2][1]).toBe('{{1}}');

    const readingId = commit.created.find((c: { title: string }) => c.title.includes('Reading')).setId;
    const reading = (await as(admin)(http(app).get(`/admin/question-sets/${readingId}`)).expect(200)).body;
    expect(reading.stimulus.sections).toHaveLength(3);
    expect(reading.questions.filter((q: { bankSectionIndex: number }) => q.bankSectionIndex === 0)).toHaveLength(13);
    expect(reading.questions.filter((q: { bankSectionIndex: number }) => q.bankSectionIndex === 1)).toHaveLength(12);
    expect(reading.questions.filter((q: { bankSectionIndex: number }) => q.bankSectionIndex === 2)).toHaveLength(15);

    // Full end-to-end: publish this exact Listening set, let a claimed free test pick it, and confirm
    // the student-facing paper carries the real contentBlocks through the wrapper-assessment build —
    // not just that the bank storage shape is right. claim() needs a published Reading set to also
    // exist (it picks one of each), so this set is published too, even though only Listening is asserted.
    await post(`/admin/question-sets/${listeningId}/status`, { status: 'APPROVED' }).expect(200);
    await post(`/admin/question-sets/${listeningId}/status`, { status: 'PUBLISHED', studentFacing: true }).expect(200);
    await post(`/admin/question-sets/${readingId}/status`, { status: 'APPROVED' }).expect(200);
    await post(`/admin/question-sets/${readingId}/status`, { status: 'PUBLISHED', studentFacing: true }).expect(200);

    let wrapped = await prisma.questionSet.findUniqueOrThrow({ where: { id: listeningId } });
    let leadId = '';
    for (let i = 0; i < 8 && !wrapped.wrapperAssessmentId; i++) {
      leadId = (await http(app).post('/free-test/claim').send({ email: `lead-${uniq()}@test.local`, phone: randomPhone() }).expect(201)).body.leadId;
      wrapped = await prisma.questionSet.findUniqueOrThrow({ where: { id: listeningId } });
    }
    expect(wrapped.wrapperAssessmentId, 'This set was never picked by a free-test claim after 8 tries — rerun or widen the retry bound.').not.toBeNull();

    const studentSection = (await http(app).get(`/free-test/${leadId}/section`).expect(200)).body;
    expect(studentSection.paper).toHaveLength(4);
    const part1 = studentSection.paper[0];
    expect(part1.content.contentBlocks).toHaveLength(8);
    expect(part1.questions).toHaveLength(10);
    const part2 = studentSection.paper[1];
    expect(part2.content.contentBlocks.some((b: { type: string }) => b.type === 'image')).toBe(true);
    // Answer keys / correctness never reach the student, same guarantee as every other free-test module.
    expect(JSON.stringify(studentSection)).not.toContain('isCorrect');
  });
});
