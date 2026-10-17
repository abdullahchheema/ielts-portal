import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { Session, as, http, loginAdmin, uniq } from './helpers';

/** Phase 4: the anonymous free-test flow — claim, rotation, the test itself, and the restricted result. */

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

/** A small published diagnostic assessment with known answers, usable as a free-test config target. */
async function buildFreeAssessment(correctValue: 'TRUE' | 'FALSE' = 'TRUE') {
  const a = (await post('/admin/assessments', { title: `Free diag ${uniq()}`, type: 'DIAGNOSTIC', showAnswers: true }).expect(201)).body;
  const versionId = (await as(admin)(http(app).get(`/admin/assessments/${a.id}`)).expect(200)).body.versions[0].id as string;
  const sectionId = (await post(`/admin/assessment-versions/${versionId}/sections`, { title: 'Part 1' }).expect(201)).body.id as string;
  await post(`/admin/assessment-sections/${sectionId}/questions`, { type: 'TFNG', prompt: { text: 'Q1' }, marks: 1, answerKey: { value: correctValue } }).expect(201);
  await post(`/admin/assessment-versions/${versionId}/publish`).expect(200);
  return a.id as string;
}

async function registerFreeConfig(name: string) {
  const assessmentId = await buildFreeAssessment();
  const config = (await post('/admin/free-test-configs', { name, assessmentId, sequence: 0 }).expect(201)).body;
  return config.id as string;
}

describe('free-test claim and identity', () => {
  it('claiming twice with the same identity returns the same lead (idempotent)', async () => {
    await registerFreeConfig(`Config ${uniq()}`);
    const email = `lead-${uniq()}@test.local`;
    const phone = `03${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;
    const first = (await http(app).post('/free-test/claim').send({ email, phone }).expect(201)).body;
    const second = (await http(app).post('/free-test/claim').send({ email, phone }).expect(201)).body;
    expect(second.leadId).toBe(first.leadId);
  });

  it('a different phone with the same email is a different identity (not a collision)', async () => {
    await registerFreeConfig(`Config ${uniq()}`);
    const email = `lead-${uniq()}@test.local`;
    const first = (await http(app).post('/free-test/claim').send({ email, phone: '03001112222' }).expect(201)).body;
    const second = (await http(app).post('/free-test/claim').send({ email, phone: '03003334444' }).expect(201)).body;
    expect(second.leadId).not.toBe(first.leadId);
  });

  it('rejects a malformed phone number', async () => {
    await http(app).post('/free-test/claim').send({ email: `lead-${uniq()}@test.local`, phone: 'x' }).expect(422);
  });

  it('a completed free test cannot be re-claimed', async () => {
    await registerFreeConfig(`Config ${uniq()}`);
    const email = `lead-${uniq()}@test.local`;
    const phone = `03${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;
    const claim = (await http(app).post('/free-test/claim').send({ email, phone }).expect(201)).body;
    const started = (await http(app).post(`/free-test/${claim.leadId}/start`).expect(201)).body;
    const q = started.paper[0].questions[0] as PaperQ;
    await http(app).put(`/free-test/${claim.leadId}/answers`).send({ revision: 0, answers: [{ questionVersionId: q.id, answer: { value: 'TRUE' } }] }).expect(200);
    await http(app).post(`/free-test/${claim.leadId}/submit`).expect(200);

    await http(app).post('/free-test/claim').send({ email, phone }).expect(409);
  });
});

describe('free-test full flow and restricted results', () => {
  it('claim -> start -> save -> submit -> result shows overall score only, never per-question data', async () => {
    await registerFreeConfig(`Config ${uniq()}`);
    const email = `lead-${uniq()}@test.local`;
    const phone = `03${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;
    const claim = (await http(app).post('/free-test/claim').send({ email, phone }).expect(201)).body;
    expect(claim.resumable).toBe(false);

    const started = (await http(app).post(`/free-test/${claim.leadId}/start`).expect(201)).body;
    expect(started.paper).toBeDefined();
    const q = started.paper[0].questions[0] as PaperQ;

    const saved = (await http(app).put(`/free-test/${claim.leadId}/answers`).send({ revision: 0, answers: [{ questionVersionId: q.id, answer: { value: 'TRUE' } }] }).expect(200)).body;
    expect(saved.revision).toBe(1);

    const submitted = (await http(app).post(`/free-test/${claim.leadId}/submit`).expect(200)).body;
    expect(submitted.score.raw).toBe(1);
    expect(submitted.score.max).toBe(1);
    expect(submitted).not.toHaveProperty('review');
    expect(JSON.stringify(submitted)).not.toContain('correctAnswer');
    expect(JSON.stringify(submitted)).not.toContain('yourAnswer');

    const result = (await http(app).get(`/free-test/${claim.leadId}/result`).expect(200)).body;
    expect(result.score.raw).toBe(1);
    expect(result).not.toHaveProperty('review');

    // Starting again after completion is refused — one entitlement only.
    await http(app).post(`/free-test/${claim.leadId}/start`).expect(409);
  });

  it('concurrent claims for the same identity do not create duplicate leads', async () => {
    await registerFreeConfig(`Config ${uniq()}`);
    const email = `lead-${uniq()}@test.local`;
    const phone = `03${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;
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

  it('rotation spreads new leads across active configurations', async () => {
    const name = `Rotation ${uniq()}`;
    await registerFreeConfig(`${name} A`);
    await registerFreeConfig(`${name} B`);
    const assigned = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const email = `rot-${uniq()}@test.local`;
      const phone = `03${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;
      const claim = (await http(app).post('/free-test/claim').send({ email, phone }).expect(201)).body;
      assigned.add(claim.assessmentId);
    }
    expect(assigned.size).toBeGreaterThan(1); // spread across more than one config, not all piled on one
  });
});

describe('free-test registration linking', () => {
  it('registering with the same email links the lead without granting a new free attempt', async () => {
    await registerFreeConfig(`Config ${uniq()}`);
    const email = `lead-${uniq()}@test.local`;
    const phone = `03${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;
    const claim = (await http(app).post('/free-test/claim').send({ email, phone }).expect(201)).body;
    const started = (await http(app).post(`/free-test/${claim.leadId}/start`).expect(201)).body;
    const q = started.paper[0].questions[0] as PaperQ;
    await http(app).put(`/free-test/${claim.leadId}/answers`).send({ revision: 0, answers: [{ questionVersionId: q.id, answer: { value: 'TRUE' } }] }).expect(200);
    await http(app).post(`/free-test/${claim.leadId}/submit`).expect(200);

    await http(app).post('/auth/register').send({ email, password: 'Str0ngPassw0rd!', firstName: 'Real', lastName: 'Student', phone: '03009998888' }).expect(201);

    const lead = await prisma.freeAssessmentLead.findUniqueOrThrow({ where: { id: claim.leadId } });
    expect(lead.linkedStudentId).not.toBeNull();
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { student: true } });
    const attempt = await prisma.assessmentAttempt.findFirstOrThrow({ where: { studentId: user.student!.id } });
    expect(attempt.studentId).toBe(user.student!.id); // the free attempt now belongs to the real account

    // Registering does not grant a second free claim for the same identity.
    await http(app).post('/free-test/claim').send({ email, phone }).expect(409);
  });
});
