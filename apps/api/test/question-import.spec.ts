import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { Session, as, http, loginAdmin, uniq } from './helpers';

/** Phase 2: bulk question import — preview (validate + flag duplicates) and commit (persist as drafts). */

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

const post = (path: string, body: object) => as(admin)(http(app).post(path)).send(body);

function validPayload(title = `Import ${uniq()}`) {
  return {
    sets: [{
      title, skill: 'READING', module: 'ACADEMIC', difficulty: 3,
      questions: [
        { ieltsType: 'TFNG', prompt: { text: `The sky is blue. ${uniq()}` }, marks: 1, answerKey: { value: 'TRUE' } },
        { ieltsType: 'SHORT_ANSWER', prompt: { text: `What color is the sky? ${uniq()}` }, marks: 1, answerKey: { accepted: ['blue'] } },
        {
          ieltsType: 'ORDERING_EVENTS', prompt: { text: `Order the steps. ${uniq()}` }, marks: 2,
          options: [{ label: 'First' }, { label: 'Second' }, { label: 'Third' }],
          answerKey: { correctOrder: ['First', 'Second', 'Third'] },
        },
      ],
    }],
  };
}

describe('bulk question import', () => {
  it('preview validates and reports zero issues for a well-formed payload', async () => {
    const res = (await post('/admin/question-sets/import/preview', validPayload()).expect(200)).body;
    expect(res.totalQuestions).toBe(3);
    expect(res.totalIssues).toBe(0);
    expect(res.sets[0].issues).toEqual([]);
  });

  it('preview flags an invalid question without touching the database', async () => {
    const payload = validPayload();
    payload.sets[0].questions.push({ ieltsType: 'TFNG', prompt: { text: 'No answer key' }, marks: 1 } as never);
    const before = await prisma.questionSet.count();
    const res = (await post('/admin/question-sets/import/preview', payload).expect(200)).body;
    expect(res.totalIssues).toBeGreaterThan(0);
    const after = await prisma.questionSet.count();
    expect(after).toBe(before);
  });

  it('preview flags a prompt that duplicates an existing question', async () => {
    const title = `Dup source ${uniq()}`;
    const promptText = `Unique duplicate-check prompt ${uniq()}`;
    await post('/admin/question-sets', { title, skill: 'READING', difficulty: 3 });
    const setId = (await as(admin)(http(app).get('/admin/question-sets')).expect(200)).body.items.find((s: { title: string }) => s.title === title).id;
    await post(`/admin/question-sets/${setId}/questions`, { ieltsType: 'TFNG', prompt: { text: promptText }, marks: 1, answerKey: { value: 'TRUE' } }).expect(201);

    const payload = validPayload();
    payload.sets[0].questions.push({ ieltsType: 'TFNG', prompt: { text: promptText }, marks: 1, answerKey: { value: 'FALSE' } } as never);
    const res = (await post('/admin/question-sets/import/preview', payload).expect(200)).body;
    expect(res.totalDuplicates).toBe(1);
    expect(res.sets[0].duplicates[0].matchedPrompt).toBe(promptText);
  });

  it('commit persists sets as published-but-hidden with graded questions, and refuses when any question is invalid', async () => {
    const payload = validPayload();
    const res = (await post('/admin/question-sets/import/commit', payload).expect(201)).body;
    expect(res.created).toHaveLength(1);
    expect(res.created[0].questionCount).toBe(3);

    const set = (await as(admin)(http(app).get(`/admin/question-sets/${res.created[0].setId}`)).expect(200)).body;
    expect(set.status).toBe('PUBLISHED');
    expect(set.studentFacing).toBe(false);
    expect(set.questions).toHaveLength(3);
    const ordering = set.questions.find((q: { questionType: string }) => q.questionType === 'ORDERING');
    expect(ordering.versions[0].options).toHaveLength(3);
    expect(ordering.versions[0].answerKey.correctOrder).toHaveLength(3);
    // The imported correctOrder must reference the real, freshly-generated option ids, not the labels.
    const optionIds = new Set(ordering.versions[0].options.map((o: { id: string }) => o.id));
    for (const id of ordering.versions[0].answerKey.correctOrder) expect(optionIds.has(id)).toBe(true);

    const invalidPayload = validPayload();
    invalidPayload.sets[0].questions.push({ ieltsType: 'TFNG', prompt: { text: 'No answer key' }, marks: 1 } as never);
    const before = await prisma.questionSet.count();
    await post('/admin/question-sets/import/commit', invalidPayload).expect(422);
    const after = await prisma.questionSet.count();
    expect(after).toBe(before); // nothing persisted on a rejected commit
  });

  it('a large import (multiple sets) commits in one transaction', async () => {
    const payload = { sets: [validPayload('Batch A').sets[0], validPayload('Batch B').sets[0]] };
    const res = (await post('/admin/question-sets/import/commit', payload).expect(201)).body;
    expect(res.created).toHaveLength(2);
  });

  it('`publish: true` makes every imported set student-facing immediately, no separate toggle', async () => {
    const payload = { ...validPayload(), publish: true };
    const res = (await post('/admin/question-sets/import/commit', payload).expect(201)).body;
    const set = (await as(admin)(http(app).get(`/admin/question-sets/${res.created[0].setId}`)).expect(200)).body;
    expect(set.status).toBe('PUBLISHED');
    expect(set.studentFacing).toBe(true);
  });
});

describe('deleting a question set', () => {
  it('permanently removes a freshly-imported set and all of its questions', async () => {
    const res = (await post('/admin/question-sets/import/commit', validPayload()).expect(201)).body;
    const setId = res.created[0].setId as string;
    const before = await prisma.question.count({ where: { questionSetId: setId } });
    expect(before).toBeGreaterThan(0);

    await as(admin)(http(app).delete(`/admin/question-sets/${setId}`)).expect(200);

    expect(await prisma.questionSet.findUnique({ where: { id: setId } })).toBeNull();
    expect(await prisma.question.count({ where: { questionSetId: setId } })).toBe(0);
  });

  it('deletes a published set too — status is not a restriction', async () => {
    const res = (await post('/admin/question-sets/import/commit', validPayload()).expect(201)).body;
    const setId = res.created[0].setId as string;
    await post(`/admin/question-sets/${setId}/status`, { status: 'PUBLISHED', studentFacing: true }).expect(200);

    await as(admin)(http(app).delete(`/admin/question-sets/${setId}`)).expect(200);
    expect(await prisma.questionSet.findUnique({ where: { id: setId } })).toBeNull();
  });

  it('permanently removes an ARCHIVED set — archiving already took it out of circulation', async () => {
    const res = (await post('/admin/question-sets/import/commit', validPayload()).expect(201)).body;
    const setId = res.created[0].setId as string;
    await post(`/admin/question-sets/${setId}/status`, { status: 'ARCHIVED' }).expect(200);

    await as(admin)(http(app).delete(`/admin/question-sets/${setId}`)).expect(200);
    expect(await prisma.questionSet.findUnique({ where: { id: setId } })).toBeNull();
  });
});
