import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { Session, as, http, loginAdmin, uniq } from './helpers';

/**
 * The unified "upload a module" flow: one bulk-import payload, any mix of skills, each set becomes
 * its own independent free-test rotation unit — no manual re-typing into a separate Assessments
 * screen for Listening/Reading, no separate "publish" click for Writing/Speaking.
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

const post = (path: string, body: object) => as(admin)(http(app).post(path)).send(body);
const get = (path: string) => as(admin)(http(app).get(path));

function payload() {
  const listeningTitle = `Mock ${uniq()} - Listening`;
  const writingTitle = `Mock ${uniq()} - Writing`;
  return {
    sets: [
      {
        title: listeningTitle, skill: 'LISTENING', module: 'ACADEMIC', difficulty: 3,
        stimulus: { passage: 'Audio transcript placeholder for the Listening module.' },
        questions: [
          { ieltsType: 'TFNG', prompt: { text: `The speaker mentions a library. ${uniq()}` }, marks: 1, answerKey: { value: 'TRUE' } },
          { ieltsType: 'TFNG', prompt: { text: `The speaker mentions a stadium. ${uniq()}` }, marks: 1, answerKey: { value: 'FALSE' } },
        ],
      },
      {
        title: writingTitle, skill: 'WRITING', module: 'ACADEMIC', difficulty: 3,
        questions: [
          { ieltsType: 'WRITING_TASK2', prompt: { text: `Discuss the impact of remote work. ${uniq()}` }, marks: 1 },
        ],
      },
    ],
    listeningTitle, writingTitle,
  };
}

describe('unified module upload', () => {
  it('turns a Listening set into a published DIAGNOSTIC assessment and archives the staging bank set', async () => {
    const { sets, listeningTitle } = payload();
    const res = (await post('/admin/free-test-pool/modules', { sets: [sets[0]] }).expect(201)).body;
    expect(res.modules).toHaveLength(1);
    const m = res.modules[0];
    expect(m.kind).toBe('ASSESSMENT');
    expect(m.skill).toBe('LISTENING');
    expect(m.needsAudio).toBe(true);

    const assessment = (await get(`/admin/assessments/${m.moduleId}`).expect(200)).body;
    expect(assessment.type).toBe('DIAGNOSTIC');
    expect(assessment.skill).toBe('LISTENING');
    expect(assessment.title).toBe(listeningTitle);
    expect(assessment.versions[0].publishedAt).not.toBeNull();

    const version = (await get(`/admin/assessments/${m.moduleId}`).expect(200)).body.versions[0];
    const full = (await as(admin)(http(app).get(`/admin/assessment-versions/${version.id}`)).expect(200)).body;
    expect(full.sections).toHaveLength(1);
    expect(full.sections[0].questions).toHaveLength(2);
    expect(full.sections[0].content.passage).toContain('Audio transcript placeholder');

    // The staging bank set that the bulk importer created is archived, not left dangling as a
    // duplicate of content that now lives in the assessment.
    const staged = await prisma.questionSet.findMany({ where: { title: listeningTitle } });
    expect(staged).toHaveLength(1);
    expect(staged[0].status).toBe('ARCHIVED');
  });

  it('publishes a Writing set directly as a bank module, with no assessment involved', async () => {
    const { sets, writingTitle } = payload();
    const res = (await post('/admin/free-test-pool/modules', { sets: [sets[1]] }).expect(201)).body;
    const m = res.modules[0];
    expect(m.kind).toBe('QUESTION_SET');
    expect(m.skill).toBe('WRITING');
    expect(m.needsAudio).toBeUndefined();

    const set = await prisma.questionSet.findUniqueOrThrow({ where: { id: m.moduleId } });
    expect(set.title).toBe(writingTitle);
    expect(set.status).toBe('PUBLISHED');
    expect(set.studentFacing).toBe(true);
  });

  it('one upload with a mix of skills produces independent modules for each, visible in the unified listing and pool stats', async () => {
    const { sets } = payload();
    const before = (await get('/admin/free-test-pool').expect(200)).body;
    const res = (await post('/admin/free-test-pool/modules', { sets }).expect(201)).body;
    expect(res.modules).toHaveLength(2);
    expect(new Set(res.modules.map((m: { skill: string }) => m.skill))).toEqual(new Set(['LISTENING', 'WRITING']));

    const after = (await get('/admin/free-test-pool').expect(200)).body;
    expect(after.listening).toBe(before.listening + 1);
    expect(after.writing).toBe(before.writing + 1);

    const listing = (await get('/admin/free-test-pool/modules').expect(200)).body;
    const ids = new Set(listing.map((row: { id: string }) => row.id));
    for (const m of res.modules) expect(ids.has(m.moduleId)).toBe(true);
    for (const row of listing.filter((r: { id: string }) => res.modules.some((m: { moduleId: string }) => m.moduleId === r.id))) {
      expect(row.published).toBe(true);
    }
  });
});
