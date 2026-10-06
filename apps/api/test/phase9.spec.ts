import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { FeedbackService } from '../src/feedback/feedback.service';
import { as, createOpenBatch, createStudent, enrollStudent, http, loginAdmin, Session, uniq } from './helpers';

/** Feedback requests, anonymous responses and the staff NPS summary, against the database. */

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

const get = (s: Session, path: string) => as(s)(http(app).get(path));
const post = (s: Session, path: string, body: object = {}) => as(s)(http(app).post(path)).send(body);

async function waitForStage(studentId: string, stage: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if ((await prisma.studentLifecycle.findUnique({ where: { studentId }, select: { stage: true } }))?.stage === stage) return;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error(`Stage did not reach ${stage}`);
}

/** Lifecycle changes and their feedback requests are created asynchronously after the request that caused them. */
async function waitForRequest(studentId: string, trigger: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const r = await prisma.feedbackRequest.findFirst({ where: { studentId, survey: { triggerKind: trigger } } });
    if (r) return r;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error(`No ${trigger} request appeared for ${studentId}`);
}

describe('feedback requests', () => {
  it('the four default surveys exist, one per trigger', async () => {
    const triggers = (await prisma.feedbackSurvey.findMany({ select: { triggerKind: true } })).map((s) => s.triggerKind);
    expect(triggers).toEqual(expect.arrayContaining(['ONBOARDING', 'MID_COURSE', 'MOCK_EXAM', 'COMPLETION']));
  });

  it('a student is asked once when they first become active, and the request is answerable, once', async () => {
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    await waitForStage(st.studentId, 'ENROLLED');
    await post(admin, `/admin/students/${st.studentId}/lifecycle`, { to: 'ACTIVE', reason: 'First class attended (test)' }).expect(200);

    const req = await waitForRequest(st.studentId, 'ONBOARDING');
    const pending = (await get(st.session, '/me/feedback/pending').expect(200)).body as { id: string; trigger: string }[];
    expect(pending.map((p) => p.id)).toContain(req.id);

    // Asking again for the same trigger does not create a second request.
    expect(await app.get(FeedbackService).requestFor(st.studentId, 'ONBOARDING', st.studentId)).toBe(false);
    expect(await prisma.feedbackRequest.count({ where: { studentId: st.studentId, survey: { triggerKind: 'ONBOARDING' } } })).toBe(1);

    await post(st.session, `/me/feedback/${req.id}/respond`, { score: 9, anonymous: false, comments: { overall: 'Clear first week' } }).expect(201);
    await post(st.session, `/me/feedback/${req.id}/respond`, { score: 4 }).expect(409);
    expect((await prisma.feedbackRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('COMPLETED');
    expect((await get(st.session, '/me/feedback/pending').expect(200)).body.map((p: { id: string }) => p.id)).not.toContain(req.id);
  });

  it('an anonymous answer to a completion request is stored without any link to the student', async () => {
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    await waitForStage(st.studentId, 'ENROLLED');
    await post(admin, `/admin/students/${st.studentId}/lifecycle`, { to: 'ACTIVE', reason: 'Started (test)' }).expect(200);
    await post(admin, `/admin/students/${st.studentId}/lifecycle`, { to: 'COMPLETED', reason: 'Finished (test)' }).expect(200);

    const req = await waitForRequest(st.studentId, 'COMPLETION');
    const res = await post(st.session, `/me/feedback/${req.id}/respond`, {
      score: 2, anonymous: true, comments: { teacher: 'The teacher was slow to reply' },
    }).expect(201);
    // The response id is the only thing returned; it does not identify the request or the student.
    expect(Object.keys(res.body)).toEqual(['id']);

    const row = await prisma.feedbackResponse.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.anonymous).toBe(true);
    expect(row.studentId).toBeNull();
    expect(row.requestId).toBeNull();
    expect(row.score).toBe(2);
    expect(row.commentTeacher).toBe('The teacher was slow to reply');
    // The request is still closed, so the student cannot answer twice.
    expect((await prisma.feedbackRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('COMPLETED');
    await post(st.session, `/me/feedback/${req.id}/respond`, { score: 9 }).expect(409);
  });

  it('a student cannot answer or dismiss someone else’s request, and scores are range-checked', async () => {
    const batchId = await createOpenBatch(app, admin);
    const owner = await enrollStudent(app, prisma, admin, batchId);
    await waitForStage(owner.studentId, 'ENROLLED');
    const stranger = await createStudent(app, prisma);
    await post(admin, `/admin/students/${owner.studentId}/lifecycle`, { to: 'ACTIVE', reason: 'Started (test)' }).expect(200);
    const req = await waitForRequest(owner.studentId, 'ONBOARDING');

    await post(stranger.session, `/me/feedback/${req.id}/respond`, { score: 9 }).expect(404);
    await post(stranger.session, `/me/feedback/${req.id}/dismiss`).expect(404);
    await post(owner.session, `/me/feedback/${req.id}/respond`, { score: 11 }).expect(422);
  });

  it('a request can be dismissed once, and a dismissed request cannot then be answered', async () => {
    const st = await createStudent(app, prisma);
    const svc = app.get(FeedbackService);
    expect(await svc.requestFor(st.studentId, 'MOCK_EXAM', uniq())).toBe(true);
    const req = await prisma.feedbackRequest.findFirstOrThrow({ where: { studentId: st.studentId, survey: { triggerKind: 'MOCK_EXAM' } } });
    await post(st.session, `/me/feedback/${req.id}/dismiss`).expect(200);
    await post(st.session, `/me/feedback/${req.id}/dismiss`).expect(409);
    await post(st.session, `/me/feedback/${req.id}/respond`, { score: 9 }).expect(409);
  });
});

describe('feedback records and the staff summary', () => {
  it('a stored response cannot be edited or deleted', async () => {
    const row = await prisma.feedbackResponse.findFirst({ where: { anonymous: true } });
    if (!row) throw new Error('expected an anonymous response from an earlier test');
    await expect(prisma.feedbackResponse.update({ where: { id: row.id }, data: { score: 10 } })).rejects.toThrow();
    await expect(prisma.feedbackResponse.delete({ where: { id: row.id } })).rejects.toThrow();
  });

  it('staff see the aggregate summary; students cannot', async () => {
    const st = await createStudent(app, prisma);
    await get(st.session, '/admin/feedback?days=30').expect(403);
    const s = (await get(admin, '/admin/feedback?days=30').expect(200)).body as {
      overall: { responses: number; suppressed: boolean }; triggers: unknown[]; trend: unknown[]; themes: unknown[]; recent: { anonymous: boolean }[];
    };
    expect(s.overall.responses).toBeGreaterThanOrEqual(1);
    expect(s.triggers).toHaveLength(4);
    expect(Array.isArray(s.trend)).toBe(true);
    // Recent items carry no student identity.
    expect(JSON.stringify(s.recent)).not.toMatch(/@test\.local/);
  });

  it('the summary rejects an out-of-range window', async () => {
    await get(admin, '/admin/feedback?days=2').expect(422);
  });
});
