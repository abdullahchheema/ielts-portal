import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { PASSWORD, Session, as, http, login, loginAdmin, uniq } from './helpers';

/**
 * Phase 7: teacher-authored Listening/Reading assessments. A mentor builds through the same
 * AssessmentsAdminService the admin section uses (apps/api/src/assessments/teacher-assessments.controller.ts
 * delegates to it directly), wrapped with an ownership guard so one mentor never sees or edits
 * another's drafts, and restricted to Listening/Reading (no MOCK/DIAGNOSTIC). Assigning a published
 * assessment to students reuses AttemptsService.resolveAccess()'s existing ContentItem path
 * unchanged — not exercised here since it's zero-change, already covered by existing content/
 * learning tests.
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
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const post = (path: string, body: object = {}) => as(admin)(http(app).post(path)).send(body);

async function mentor() {
  const email = `teacher-${uniq()}@test.local`;
  const m = (await post('/admin/mentors', { email, displayName: 'Teacher ' + uniq(), password: PASSWORD }).expect(201)).body;
  return { id: m.id as string, session: await login(app, email) };
}

describe('teacher-authored assessments: ownership and scope', () => {
  it('a mentor can create, build and publish a Listening assessment, visible only to them', async () => {
    const t1 = await mentor();
    const created = (await as(t1.session)(http(app).post('/mentor/assessments')).send({
      title: `Teacher test ${uniq()}`, type: 'LISTENING', skill: 'LISTENING', timeLimitMin: 30,
    }).expect(201)).body;
    expect(created.id).toBeTruthy();

    const row = await prisma.assessment.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.createdByMentorId).toBe(t1.id);

    const versionId = (await as(t1.session)(http(app).get(`/mentor/assessments/${created.id}`)).expect(200)).body.versions[0].id;
    const section = (await as(t1.session)(http(app).post(`/mentor/assessments/versions/${versionId}/sections`)).send({ title: 'Part 1' }).expect(201)).body;
    await as(t1.session)(http(app).post(`/mentor/assessments/sections/${section.id}/questions`)).send({
      type: 'TFNG', prompt: { text: 'The sky is blue.' }, marks: 1, answerKey: { value: 'TRUE' },
    }).expect(201);
    await as(t1.session)(http(app).post(`/mentor/assessments/versions/${versionId}/publish`)).send({}).expect(200);

    const list = (await as(t1.session)(http(app).get('/mentor/assessments')).expect(200)).body as Array<{ id: string }>;
    expect(list.some((a) => a.id === created.id)).toBe(true);
  }, 60_000);

  it('a different mentor cannot see, read, or edit another mentor\'s assessment', async () => {
    const t1 = await mentor();
    const t2 = await mentor();
    const created = (await as(t1.session)(http(app).post('/mentor/assessments')).send({
      title: `Private ${uniq()}`, type: 'READING', skill: 'READING',
    }).expect(201)).body;

    const list = (await as(t2.session)(http(app).get('/mentor/assessments')).expect(200)).body as Array<{ id: string }>;
    expect(list.some((a) => a.id === created.id)).toBe(false);

    await as(t2.session)(http(app).get(`/mentor/assessments/${created.id}`)).expect(404);
    await as(t2.session)(http(app).patch(`/mentor/assessments/${created.id}`)).send({ title: 'Hijacked' }).expect(404);
    await as(t2.session)(http(app).post(`/mentor/assessments/${created.id}/versions`)).send({}).expect(404);
  });

  it('rejects a MOCK or DIAGNOSTIC type, and a Writing/Speaking skill', async () => {
    const t1 = await mentor();
    const api = (body: object) => as(t1.session)(http(app).post('/mentor/assessments')).send(body);

    await api({ title: `No mock ${uniq()}`, type: 'MOCK', skill: 'LISTENING' }).expect(422);
    await api({ title: `No diagnostic ${uniq()}`, type: 'DIAGNOSTIC', skill: 'READING' }).expect(422);
    await api({ title: `No writing ${uniq()}`, type: 'LISTENING', skill: 'WRITING' }).expect(422);
  });

  it('admin assessment routes stay admin-only: a mentor cannot reach them even with assessment.author', async () => {
    const t1 = await mentor();
    await as(t1.session)(http(app).get('/admin/assessments')).expect(403);
  });
});
