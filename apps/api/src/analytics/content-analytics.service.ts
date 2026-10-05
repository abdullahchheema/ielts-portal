import { Injectable } from '@nestjs/common';
import { notFound } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { MIN_GROUP } from './admin-analytics.service';
import { COHORT_STATUSES } from './risk.service';

/**
 * Where students drop off in the course, and which questions are too hard or too easy.
 * These are content-quality signals for the course team, not judgements of students.
 */
export function pointBiserial(answers: { correct: boolean; percent: number }[]): number | null {
  const n = answers.length;
  if (n < 10) return null; // too few answers for the figure to mean anything
  const correct = answers.filter((a) => a.correct);
  const wrong = answers.filter((a) => !a.correct);
  if (correct.length === 0 || wrong.length === 0) return null;
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const mCorrect = mean(correct.map((a) => a.percent));
  const mWrong = mean(wrong.map((a) => a.percent));
  const all = answers.map((a) => a.percent);
  const mAll = mean(all);
  const sd = Math.sqrt(all.reduce((s, x) => s + (x - mAll) ** 2, 0) / n);
  if (sd === 0) return null;
  const p = correct.length / n;
  const r = ((mCorrect - mWrong) / sd) * Math.sqrt(p * (1 - p));
  return Math.round(r * 100) / 100;
}

@Injectable()
export class ContentAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Each lesson or test item: how many started, how many finished, and the completion rate. */
  async courseItems(courseVersionId: string) {
    const version = await this.prisma.courseVersion.findUnique({ where: { id: courseVersionId }, select: { id: true } });
    if (!version) throw notFound('Course version');
    const items = await this.prisma.contentItem.findMany({
      where: { section: { courseVersionId } },
      select: { id: true, title: true, contentType: true, section: { select: { title: true } } },
      orderBy: [{ section: { sequence: 'asc' } }, { sequence: 'asc' }],
    });
    const cohort = await this.prisma.enrollment.findMany({
      where: { courseVersionId, deletedAt: null, status: { in: [...COHORT_STATUSES] } }, select: { studentId: true }, take: 5000,
    });
    const cohortIds = cohort.map((c) => c.studentId);
    const progress = cohortIds.length === 0 ? [] : await this.prisma.contentProgress.groupBy({
      by: ['contentItemId', 'status'], where: { studentId: { in: cohortIds }, contentItemId: { in: items.map((i) => i.id) } }, _count: true,
    });
    const rows = items.map((it) => {
      const mine = progress.filter((p) => p.contentItemId === it.id);
      const started = mine.filter((p) => p.status !== 'NOT_STARTED').reduce((s, p) => s + p._count, 0);
      const completed = mine.find((p) => p.status === 'COMPLETED')?._count ?? 0;
      return {
        itemId: it.id, section: it.section.title, title: it.title, contentType: it.contentType,
        started, completed,
        completionPercent: started >= MIN_GROUP ? Math.round((completed / started) * 100) : null,
      };
    });
    return { cohortSize: cohortIds.length, items: rows };
  }

  /**
   * Item analysis for one assessment: success rate per question and discrimination, which is how
   * well a question separates strong students from weak ones. Null whenever the data is too thin.
   */
  async questions(assessmentId: string) {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId }, select: { id: true, title: true, versions: { orderBy: { version: 'desc' }, take: 1, select: { id: true } } },
    });
    if (!assessment || assessment.versions.length === 0) throw notFound('Assessment');
    const versionId = assessment.versions[0].id;
    // A question can have several versions; only the newest of each is analysed.
    const all = await this.prisma.questionVersion.findMany({
      where: { question: { section: { assessmentVersionId: versionId } } },
      select: { id: true, version: true, questionId: true, prompt: true, question: { select: { questionType: true } } },
    });
    const newest = new Map<string, (typeof all)[number]>();
    for (const v of all) if (!newest.has(v.questionId) || newest.get(v.questionId)!.version < v.version) newest.set(v.questionId, v);
    const questions = [...newest.values()];
    const answers = await this.prisma.attemptAnswer.findMany({
      where: { questionVersionId: { in: questions.map((q) => q.id) }, isCorrect: { not: null }, attempt: { status: { in: ['AUTO_GRADED', 'GRADED'] } } },
      select: { questionVersionId: true, isCorrect: true, attempt: { select: { percent: true, id: true } } },
      take: 20000,
    });
    const rows = questions.map((q) => {
      const mine = answers.filter((a) => a.questionVersionId === q.id);
      const correct = mine.filter((a) => a.isCorrect).length;
      const samples = mine.filter((a) => a.attempt.percent !== null).map((a) => ({ correct: !!a.isCorrect, percent: Number(a.attempt.percent) }));
      return {
        questionVersionId: q.id,
        type: q.question.questionType,
        prompt: promptText(q.prompt),
        attempts: mine.length,
        correct,
        correctPercent: mine.length >= MIN_GROUP ? Math.round((correct / mine.length) * 100) : null,
        discrimination: pointBiserial(samples),
        // Time per question is not recorded, so it is reported as unavailable rather than estimated.
        medianTimeSeconds: null,
      };
    });
    return { assessmentId, title: assessment.title, questions: rows };
  }
}

function promptText(prompt: unknown): string {
  if (prompt && typeof prompt === 'object' && 'text' in prompt) return String((prompt as { text: unknown }).text).slice(0, 200);
  return '';
}
