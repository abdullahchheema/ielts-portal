import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { conflict, notFound } from '../common/app-error';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { LIFECYCLE_CHANGED, LifecycleChanged } from '../student-lifecycle/lifecycle.service';
import { SIMULATOR_COMPLETED, SimulatorCompleted } from '../simulator/events';
import { MIN_RESPONSES, monthlyTrend, npsSummary, responseRecord, themes } from './nps';

const DAY = 86_400_000;

export interface FeedbackAnswer {
  score: number;
  anonymous: boolean;
  comments: { overall?: string; teacher?: string; course?: string; technical?: string };
}

/**
 * Feedback requests and responses. A request is created once per survey, student and trigger (the unique key),
 * so a repeated event never asks the same person twice. Responses are append-only, and an anonymous response is
 * stored without any link to the student (see responseRecord).
 */
@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(private readonly prisma: PrismaService, private readonly notify: NotificationsService) {}

  @OnEvent(LIFECYCLE_CHANGED, { async: true })
  async onLifecycle(ev: LifecycleChanged) {
    try {
      // Onboarding is asked once, when the student first becomes active. Completion is asked per completion.
      if (ev.to === 'ACTIVE') await this.requestFor(ev.studentId, 'ONBOARDING', ev.studentId);
      if (ev.to === 'COMPLETED') await this.requestFor(ev.studentId, 'COMPLETION', ev.transitionId);
    } catch (err) {
      this.logger.warn(`Feedback request after lifecycle change failed: ${(err as Error).message}`);
    }
  }

  @OnEvent(SIMULATOR_COMPLETED, { async: true })
  async onMockExam(ev: SimulatorCompleted) {
    try {
      await this.requestFor(ev.studentId, 'MOCK_EXAM', ev.examAttemptId);
    } catch (err) {
      this.logger.warn(`Feedback request after mock exam failed: ${(err as Error).message}`);
    }
  }

  /** Creates the request for a trigger if an active survey exists and the student has not been asked before. */
  async requestFor(studentId: string, trigger: string, triggerRef: string): Promise<boolean> {
    const survey = await this.prisma.feedbackSurvey.findUnique({ where: { triggerKind: trigger }, select: { id: true, active: true } });
    if (!survey?.active) return false;
    const student = await this.prisma.studentProfile.findUnique({
      where: { id: studentId },
      select: { userId: true, enrollments: { where: { status: 'ACTIVE', deletedAt: null }, select: { batchId: true }, take: 1 } },
    });
    if (!student) return false;
    try {
      const req = await this.prisma.feedbackRequest.create({
        data: { surveyId: survey.id, studentId, batchId: student.enrollments[0]?.batchId ?? null, triggerRef },
        select: { id: true },
      });
      await this.notify.notifyUser(student.userId, 'FEEDBACK_REQUEST', 'A quick question for you', 'Two minutes to tell us how the academy is doing.', {
        optional: true, dedupeKey: `feedback:${req.id}`, link: '/student',
      });
      return true;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return false; // already asked for this trigger
      throw err;
    }
  }

  /** Requests the student has not answered yet, with the wording to show. */
  async pending(studentId: string) {
    const rows = await this.prisma.feedbackRequest.findMany({
      where: { studentId, status: 'PENDING', survey: { active: true } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true, survey: { select: { title: true, triggerKind: true, questions: true } } },
    });
    return rows.map((r) => ({ id: r.id, title: r.survey.title, trigger: r.survey.triggerKind, questions: r.survey.questions, createdAt: r.createdAt }));
  }

  /** Records the answer and closes the request in one transaction. Answering twice is refused. */
  async respond(studentId: string, requestId: string, answer: FeedbackAnswer) {
    return this.prisma.$transaction(async (tx) => {
      const req = await tx.feedbackRequest.findFirst({
        where: { id: requestId, studentId },
        select: { id: true, surveyId: true, batchId: true, survey: { select: { triggerKind: true } } },
      });
      if (!req) throw notFound('Feedback request');
      const moved = await tx.feedbackRequest.updateMany({ where: { id: req.id, status: 'PENDING' }, data: { status: 'COMPLETED', respondedAt: new Date() } });
      if (moved.count === 0) throw conflict('CONFLICT', 'You have already answered or dismissed this survey.');
      const created = await tx.feedbackResponse.create({
        data: responseRecord({
          surveyId: req.surveyId, batchId: req.batchId, trigger: req.survey.triggerKind, studentId, requestId: req.id,
          score: answer.score, anonymous: answer.anonymous, comments: answer.comments,
        }),
        select: { id: true },
      });
      // Only the response id is returned. It never contains the request or the student.
      return { id: created.id };
    });
  }

  async dismiss(studentId: string, requestId: string) {
    const req = await this.prisma.feedbackRequest.findFirst({ where: { id: requestId, studentId }, select: { id: true, status: true } });
    if (!req) throw notFound('Feedback request');
    const moved = await this.prisma.feedbackRequest.updateMany({ where: { id: req.id, status: 'PENDING' }, data: { status: 'DISMISSED' } });
    if (moved.count === 0) throw conflict('CONFLICT', 'This survey is no longer open.');
    return { ok: true };
  }

  /** Staff dashboard. Scores, trend, themes and groups are withheld below the minimum sample, so no one is exposed by a small figure. */
  async summary(days: number) {
    const since = new Date(Date.now() - days * DAY);
    const [responses, sent] = await Promise.all([
      this.prisma.feedbackResponse.findMany({
        where: { createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 5000,
        select: {
          score: true, createdAt: true, triggerKind: true, anonymous: true, batchId: true,
          commentOverall: true, commentTeacher: true, commentCourse: true, commentTechnical: true,
          batch: { select: { name: true } },
        },
      }),
      this.prisma.feedbackRequest.count({ where: { createdAt: { gte: since } } }),
    ]);

    const overall = npsSummary(responses.map((r) => r.score), sent);
    const triggers = ['ONBOARDING', 'MID_COURSE', 'MOCK_EXAM', 'COMPLETION'].map((t) => {
      const rows = responses.filter((r) => r.triggerKind === t);
      return { trigger: t, ...npsSummary(rows.map((r) => r.score), 0) };
    });
    const batchGroups = new Map<string, { name: string; scores: number[] }>();
    for (const r of responses) {
      if (!r.batchId) continue;
      const g = batchGroups.get(r.batchId) ?? { name: r.batch?.name ?? 'Batch', scores: [] };
      g.scores.push(r.score);
      batchGroups.set(r.batchId, g);
    }
    const byBatch = [...batchGroups.values()].map((g) => ({ batchName: g.name, ...npsSummary(g.scores, 0) }));
    const texts = responses.map((r) => [r.commentOverall, r.commentTeacher, r.commentCourse, r.commentTechnical].filter(Boolean).join(' ')).filter(Boolean);

    return {
      days,
      minimumResponses: MIN_RESPONSES,
      overall,
      triggers,
      byBatch,
      trend: monthlyTrend(responses.map((r) => ({ score: r.score, at: r.createdAt }))),
      themes: themes(texts),
      anonymousShare: responses.length ? Math.round((responses.filter((r) => r.anonymous).length / responses.length) * 100) : null,
      recent: responses.slice(0, 20).map((r) => ({
        score: r.score, trigger: r.triggerKind, at: r.createdAt, anonymous: r.anonymous,
        comments: [r.commentOverall, r.commentTeacher, r.commentCourse, r.commentTechnical].filter(Boolean),
      })),
    };
  }
}
