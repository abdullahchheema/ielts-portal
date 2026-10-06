import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ielts/db';
import { createApp } from '../src/app';
import { FeedbackService } from '../src/feedback/feedback.service';
import { StudyPlanService } from '../src/study-plan/study-plan.service';
import { as, createOpenBatch, createStudent, enrollStudent, http, loginAdmin, Session, uniq } from './helpers';

/** Study-plan task completion from events, the mid-course check-in, and the staff AI themes summary. */

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

describe('study plan evidence', () => {
  it('an item the student does completes the matching pending task of the active plan, and nothing else', async () => {
    const st = await createStudent(app, prisma);
    const plan = await prisma.studyPlan.create({ data: { studentId: st.studentId, planStatus: 'ON_TRACK', summary: 'Test plan.', inputsHash: uniq(), minutesPerDay: 30 } });
    const week = await prisma.studyPlanWeek.create({ data: { planId: plan.id, weekIndex: 0, startsOn: new Date() } });
    const day = await prisma.studyPlanDay.create({ data: { planId: plan.id, weekId: week.id, dayDate: new Date(), minutes: 30 } });
    const cardId = crypto.randomUUID();
    const matching = await prisma.studyPlanTask.create({
      data: { planId: plan.id, dayId: day.id, studentId: st.studentId, skill: 'VOCABULARY', kind: 'review', refType: 'VOCABULARY_REVIEW', refId: cardId, title: 'Review', minutes: 10, rationale: 'Due.' },
    });
    const other = await prisma.studyPlanTask.create({
      data: { planId: plan.id, dayId: day.id, studentId: st.studentId, skill: 'VOCABULARY', kind: 'review', refType: 'VOCABULARY_REVIEW', refId: crypto.randomUUID(), title: 'Other', minutes: 10, rationale: 'Due.' },
    });

    await app.get(StudyPlanService).onEvidence({ studentId: st.studentId, refType: 'VOCABULARY_REVIEW', refId: cardId });

    expect((await prisma.studyPlanTask.findUniqueOrThrow({ where: { id: matching.id } })).status).toBe('DONE');
    expect((await prisma.studyPlanTask.findUniqueOrThrow({ where: { id: other.id } })).status).toBe('PENDING');
  });

  it('evidence for another student never completes a task', async () => {
    const owner = await createStudent(app, prisma);
    const stranger = await createStudent(app, prisma);
    const plan = await prisma.studyPlan.create({ data: { studentId: owner.studentId, planStatus: 'ON_TRACK', summary: 'Test plan.', inputsHash: uniq(), minutesPerDay: 30 } });
    const week = await prisma.studyPlanWeek.create({ data: { planId: plan.id, weekIndex: 0, startsOn: new Date() } });
    const day = await prisma.studyPlanDay.create({ data: { planId: plan.id, weekId: week.id, dayDate: new Date(), minutes: 30 } });
    const refId = crypto.randomUUID();
    const task = await prisma.studyPlanTask.create({
      data: { planId: plan.id, dayId: day.id, studentId: owner.studentId, skill: 'WRITING', kind: 'practice', refType: 'WRITING_TASK', refId, title: 'Essay', minutes: 40, rationale: 'Gap.' },
    });
    await app.get(StudyPlanService).onEvidence({ studentId: stranger.studentId, refType: 'WRITING_TASK', refId });
    expect((await prisma.studyPlanTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('PENDING');
  });
});

describe('mid-course check-in', () => {
  it('a student halfway through, two weeks in, is asked once for this enrolment', async () => {
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    await prisma.enrollment.update({ where: { id: st.enrollmentId }, data: { progressPercent: 60, enrolledAt: new Date(Date.now() - 20 * 86_400_000) } });

    const svc = app.get(FeedbackService);
    const first = await svc.midCourseSweep(new Date());
    expect(first.checked).toBeGreaterThanOrEqual(1);
    const req = await prisma.feedbackRequest.findFirst({ where: { studentId: st.studentId, triggerRef: st.enrollmentId, survey: { triggerKind: 'MID_COURSE' } } });
    expect(req?.status).toBe('PENDING');

    await svc.midCourseSweep(new Date());
    expect(await prisma.feedbackRequest.count({ where: { studentId: st.studentId, triggerRef: st.enrollmentId, survey: { triggerKind: 'MID_COURSE' } } })).toBe(1);
  });

  it('a student early in the course is not asked yet', async () => {
    const batchId = await createOpenBatch(app, admin);
    const st = await enrollStudent(app, prisma, admin, batchId);
    await prisma.enrollment.update({ where: { id: st.enrollmentId }, data: { progressPercent: 10, enrolledAt: new Date(Date.now() - 20 * 86_400_000) } });
    await app.get(FeedbackService).midCourseSweep(new Date());
    expect(await prisma.feedbackRequest.count({ where: { studentId: st.studentId, triggerRef: st.enrollmentId } })).toBe(0);
  });
});

describe('feedback themes', () => {
  it('staff get themes; students do not', async () => {
    const st = await createStudent(app, prisma);
    await as(st.session)(http(app).get('/admin/feedback/themes?days=30')).expect(403);
    const body = (await as(admin)(http(app).get('/admin/feedback/themes?days=30')).expect(200)).body as { text: string; source: string };
    expect(typeof body.text).toBe('string');
    expect(['AI', 'RULES']).toContain(body.source);
    expect(body.text).not.toMatch(/@/);
  });
});
