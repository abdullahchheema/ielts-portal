import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { Session, as, http, loginAdmin, uniq } from './helpers';

/**
 * Free test v2: the anonymous free-test flow is a full 4-skill mock (`ExamAttempt`), orchestrated the
 * same way the authenticated full simulator is. Listening/Reading are each picked from whichever
 * published DIAGNOSTIC assessments exist for that skill (no fixed set — the least-used one is picked
 * each time); Writing/Speaking reuse the simulator's own bank-candidate selection unchanged. The ghost
 * never has a plan (defaults to FREE), so Writing/Speaking are never AI-evaluated — that is spec-correct,
 * not a bug: `missingSkills` records them and `overallEstimate` stays null.
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

interface PaperQ { id: string; prompt: { text: string }; options?: { id: string; label: string }[] }
const randomPhone = () => `03${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;

/** A small published DIAGNOSTIC assessment for one skill, with one TFNG question of a known answer. */
async function buildDiagnostic(skill: 'LISTENING' | 'READING', correctValue: 'TRUE' | 'FALSE' = 'TRUE') {
  const a = (await post('/admin/assessments', { title: `Free ${skill} ${uniq()}`, type: 'DIAGNOSTIC', skill, showAnswers: true }).expect(201)).body;
  const versionId = (await as(admin)(http(app).get(`/admin/assessments/${a.id}`)).expect(200)).body.versions[0].id as string;
  const sectionId = (await post(`/admin/assessment-versions/${versionId}/sections`, { title: 'Part 1' }).expect(201)).body.id as string;
  await post(`/admin/assessment-sections/${sectionId}/questions`, { type: 'TFNG', prompt: { text: 'Q1' }, marks: 1, answerKey: { value: correctValue } }).expect(201);
  await post(`/admin/assessment-versions/${versionId}/publish`).expect(200);
  return a.id as string;
}

/** A published, student-facing Writing Task 2 prompt — eligible for the simulator's own candidate pick. */
async function buildWritingPrompt() {
  const set = (await post('/admin/question-sets', { title: `Free writing ${uniq()}`, skill: 'WRITING', difficulty: 3, topic: `free-${uniq()}`, studentFacing: false }).expect(201)).body;
  await post(`/admin/question-sets/${set.id}/questions`, { ieltsType: 'WRITING_TASK2', prompt: { text: 'Some people think technology helps society. Discuss.' }, marks: 1 }).expect(201);
  await post(`/admin/question-sets/${set.id}/status`, { status: 'APPROVED' }).expect(200);
  await post(`/admin/question-sets/${set.id}/status`, { status: 'PUBLISHED', studentFacing: true }).expect(200);
  return set.id as string;
}

const ESSAY = [
  'Many people believe that technology makes life easier. In my opinion, this is true in many ways.',
  'First, technology saves time. Machines do the work that once took hours. Second, technology connects families who live far apart.',
  'However, there are drawbacks. Some people spend a lot of time on screens, and this can harm sleep and health.',
].join(' ');
/** A minimal WebM header followed by padding. Enough for the server's content sniffing. */
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(400, 7)]);

async function answerAndSubmitSection(leadId: string) {
  const section = (await http(app).get(`/free-test/${leadId}/section`).expect(200)).body;
  const q = section.paper[0].questions[0] as PaperQ;
  await http(app).put(`/free-test/${leadId}/answers`).send({ revision: section.attempt.revision, answers: [{ questionVersionId: q.id, answer: { value: 'TRUE' } }] }).expect(200);
  await http(app).post(`/free-test/${leadId}/section/submit`).expect(200);
}

/** Drives whatever stage the exam is currently in to completion, handling every stage it might land
 *  on along the way (Writing/Speaking are skipped automatically server-side when nothing is
 *  published for them, so this works whether or not the test set up prompts for them). */
async function finishFreeTest(leadId: string) {
  let exam = (await http(app).get(`/free-test/${leadId}`).expect(200)).body;
  while (exam.status !== 'COMPLETED') {
    if (exam.stage === 'LISTENING' || exam.stage === 'READING') {
      await answerAndSubmitSection(leadId);
    } else if (exam.stage === 'WRITING') {
      const essay = (await http(app).get(`/free-test/${leadId}/writing`).expect(200)).body;
      await http(app).put(`/free-test/${leadId}/writing`).send({ revision: essay.revision, body: ESSAY }).expect(200);
      await http(app).post(`/free-test/${leadId}/writing/submit`).expect(200);
    } else if (exam.stage === 'SPEAKING') {
      const resp = (await http(app).post(`/free-test/${leadId}/speaking-responses`).send({ part: 'PART1', promptText: 'What do you do in your free time?' }).expect(201)).body;
      await http(app).post(`/free-test/${leadId}/speaking-responses/${resp.id}/audio`).attach('file', WEBM, { filename: 'answer.webm', contentType: 'audio/webm' }).expect(200);
    }
    exam = (await http(app).post(`/free-test/${leadId}/advance`).send({ expectedRevision: exam.stageRevision }).expect(200)).body;
  }
  return exam;
}

describe('free-test v2: claim and identity', () => {
  it('claiming twice with the same identity returns the same lead (idempotent)', async () => {
    await buildDiagnostic('LISTENING'); await buildDiagnostic('READING');
    const email = `lead-${uniq()}@test.local`;
    const phone = randomPhone();
    const first = (await http(app).post('/free-test/claim').send({ email, phone }).expect(201)).body;
    const second = (await http(app).post('/free-test/claim').send({ email, phone }).expect(201)).body;
    expect(second.leadId).toBe(first.leadId);
  });

  it('a different phone with the same email is a different identity (not a collision)', async () => {
    await buildDiagnostic('LISTENING'); await buildDiagnostic('READING');
    const email = `lead-${uniq()}@test.local`;
    const first = (await http(app).post('/free-test/claim').send({ email, phone: randomPhone() }).expect(201)).body;
    const second = (await http(app).post('/free-test/claim').send({ email, phone: randomPhone() }).expect(201)).body;
    expect(second.leadId).not.toBe(first.leadId);
  });

  it('rejects a malformed phone number', async () => {
    await http(app).post('/free-test/claim').send({ email: `lead-${uniq()}@test.local`, phone: 'x' }).expect(422);
  });

  it('concurrent claims for the same identity do not create duplicate leads', async () => {
    await buildDiagnostic('LISTENING'); await buildDiagnostic('READING');
    const email = `lead-${uniq()}@test.local`;
    const phone = randomPhone();
    const [a, b, c] = await Promise.all([
      http(app).post('/free-test/claim').send({ email, phone }),
      http(app).post('/free-test/claim').send({ email, phone }),
      http(app).post('/free-test/claim').send({ email, phone }),
    ]);
    const leadIds = new Set([a.body.leadId, b.body.leadId, c.body.leadId]);
    expect(leadIds.size).toBe(1);
    const count = await prisma.freeAssessmentLead.count({ where: { email, phone } });
    expect(count).toBe(1);
  });

  it('rotation spreads new leads across published Listening modules', async () => {
    // Other tests in this file publish their own Listening modules into the same global pool, so
    // "least used" alone can't be asserted against a fixed count. Instead: two brand-new modules
    // start at zero uses and must therefore win every pick until each has been used at least once.
    await buildDiagnostic('READING');
    const a = await buildDiagnostic('LISTENING');
    const b = await buildDiagnostic('LISTENING');
    const picked = new Set<string>();
    for (let i = 0; i < 8 && !(picked.has(a) && picked.has(b)); i++) {
      const claim = (await http(app).post('/free-test/claim').send({ email: `rot-${uniq()}@test.local`, phone: randomPhone() }).expect(201)).body;
      const lead = await prisma.freeAssessmentLead.findUniqueOrThrow({ where: { id: claim.leadId }, include: { examAttempt: true } });
      if (lead.examAttempt?.listeningAssessmentId) picked.add(lead.examAttempt.listeningAssessmentId);
    }
    expect(picked.has(a)).toBe(true);
    expect(picked.has(b)).toBe(true);
  });
});

describe('free-test v2: full 4-skill flow', () => {
  it('claim -> listening -> reading -> writing -> speaking -> done, with a restricted overall estimate', async () => {
    await buildDiagnostic('LISTENING'); await buildDiagnostic('READING');
    await buildWritingPrompt();
    const email = `lead-${uniq()}@test.local`;
    const phone = randomPhone();
    const claim = (await http(app).post('/free-test/claim').send({ email, phone }).expect(201)).body;
    expect(claim.resumable).toBe(false);

    let exam = (await http(app).get(`/free-test/${claim.leadId}`).expect(200)).body;
    expect(exam.stage).toBe('LISTENING');
    expect(JSON.stringify(exam)).not.toContain('correctAnswer');

    await answerAndSubmitSection(claim.leadId);
    exam = (await http(app).post(`/free-test/${claim.leadId}/advance`).send({ expectedRevision: exam.stageRevision }).expect(200)).body;
    expect(exam.stage).toBe('READING');

    await answerAndSubmitSection(claim.leadId);
    exam = (await http(app).post(`/free-test/${claim.leadId}/advance`).send({ expectedRevision: exam.stageRevision }).expect(200)).body;
    expect(exam.stage).toBe('WRITING');
    expect(exam.sections.listening.band).not.toBeNull();
    expect(exam.sections.reading.band).not.toBeNull();

    exam = await finishFreeTest(claim.leadId);
    expect(exam.stage).toBe('DONE');
    expect(exam.status).toBe('COMPLETED');

    // Free tier never gets AI evaluation, so Writing/Speaking are recorded as missing and no fake
    // overall estimate is produced — this is correct behaviour, not a bug.
    expect(exam.missingSkills).toEqual(expect.arrayContaining(['WRITING', 'SPEAKING']));
    expect(exam.overallEstimate).toBeNull();

    // A completed free test cannot be claimed again for the same identity.
    await http(app).post('/free-test/claim').send({ email, phone }).expect(409);
  });
});

describe('free-test v2: registration linking', () => {
  it('registering with the same email links the lead without granting a new free attempt', async () => {
    await buildDiagnostic('LISTENING'); await buildDiagnostic('READING');
    const email = `lead-${uniq()}@test.local`;
    const phone = randomPhone();
    const claim = (await http(app).post('/free-test/claim').send({ email, phone }).expect(201)).body;
    await finishFreeTest(claim.leadId);

    await http(app).post('/auth/register').send({ email, password: 'Str0ngPassw0rd!', firstName: 'Real', lastName: 'Student', phone: '03009998888' }).expect(201);

    const lead = await prisma.freeAssessmentLead.findUniqueOrThrow({ where: { id: claim.leadId }, include: { examAttempt: true } });
    expect(lead.linkedStudentId).not.toBeNull();
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { student: true } });
    const exam = await prisma.examAttempt.findUniqueOrThrow({ where: { id: lead.examAttempt!.id } });
    expect(exam.studentId).toBe(user.student!.id); // the free attempt now belongs to the real account

    // Registering does not grant a second free claim for the same identity.
    await http(app).post('/free-test/claim').send({ email, phone }).expect(409);
  });
});
