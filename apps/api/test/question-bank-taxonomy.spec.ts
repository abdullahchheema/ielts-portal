import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { Session, as, http, loginAdmin, uniq } from './helpers';

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

async function buildSet(skill: 'LISTENING' | 'READING') {
  return (await post('/admin/question-sets', { title: `Taxonomy ${uniq()}`, skill, difficulty: 3, topic: `tax-${uniq()}`, studentFacing: false }).expect(201)).body.id as string;
}

describe('reconciled IELTS question-type taxonomy', () => {
  it('accepts the newly added Flow-chart Completion, Short-answer and Matching Sentence Endings item types, graded the same as their existing siblings', async () => {
    const readingSet = await buildSet('READING');
    const listeningSet = await buildSet('LISTENING');

    await post(`/admin/question-sets/${listeningSet}/questions`, {
      ieltsType: 'SHORT_ANSWER', prompt: { text: 'What is the capital of the country mentioned?' }, marks: 1, answerKey: { accepted: ['Paris', 'paris'] },
    }).expect(201);
    await post(`/admin/question-sets/${listeningSet}/questions`, {
      ieltsType: 'FLOW_CHART_COMPLETION', prompt: { text: 'Complete the flow-chart.' }, marks: 1, answerKey: { accepted: ['reservoir'] },
    }).expect(201);
    await post(`/admin/question-sets/${readingSet}/questions`, {
      ieltsType: 'MATCHING_SENTENCE_ENDINGS', prompt: { text: 'Match the sentence to its correct ending.' }, marks: 1,
      options: [{ label: 'A. ...because it rained.', isCorrect: true }, { label: 'B. ...despite the rain.' }],
    }).expect(201);

    const listeningDetail = (await as(admin)(http(app).get(`/admin/question-sets/${listeningSet}`)).expect(200)).body;
    expect(listeningDetail.questions.map((q: { ieltsType: string }) => q.ieltsType).sort()).toEqual(['FLOW_CHART_COMPLETION', 'SHORT_ANSWER']);
    const readingDetail = (await as(admin)(http(app).get(`/admin/question-sets/${readingSet}`)).expect(200)).body;
    expect(readingDetail.questions[0].ieltsType).toBe('MATCHING_SENTENCE_ENDINGS');
    expect(readingDetail.questions[0].versions[0].options).toHaveLength(2);

    // Completion-graded types reject a question with no accepted answer, same as existing completion types.
    await post(`/admin/question-sets/${listeningSet}/questions`, { ieltsType: 'SHORT_ANSWER', prompt: { text: 'No answer key' }, marks: 1 }).expect(422);
    // Matching-graded types require at least two options with one marked correct, same as existing matching types.
    await post(`/admin/question-sets/${readingSet}/questions`, { ieltsType: 'MATCHING_SENTENCE_ENDINGS', prompt: { text: 'No options' }, marks: 1 }).expect(422);
  });
});
