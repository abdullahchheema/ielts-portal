import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import { AuthUser, CurrentUser } from '../common/decorators';
import { forbidden } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { categorize, monthlyTrend } from './categorize';

const DAY = 86_400_000;

export interface GrammarNote { excerpt: string; correction?: string; explanation: string }

/**
 * Grammar tracking. Observations are written once per excerpt of an evaluation, and never edited, so the monthly
 * history stays truthful and re-running an evaluation cannot double-count a mistake.
 */
@Injectable()
export class GrammarService {
  constructor(private readonly prisma: PrismaService) {}

  async recordFromEvaluation(studentId: string, evaluationId: string, notes: GrammarNote[], source: 'AI_WRITING' | 'TEACHER' | 'AI_SPEAKING' = 'AI_WRITING') {
    if (notes.length === 0) return 0;
    const rows: Prisma.GrammarObservationCreateManyInput[] = notes.map((n) => ({
      studentId, categoryCode: categorize(n.explanation), source, writingEvaluationId: evaluationId, excerpt: n.excerpt.slice(0, 300), correction: n.correction?.slice(0, 300) ?? null,
    }));
    const r = await this.prisma.grammarObservation.createMany({ data: rows, skipDuplicates: true });
    return r.count;
  }

  /** Counts this calendar month and last month, per category, with the change between them. */
  async dashboard(studentId: string) {
    const now = new Date();
    const startThis = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const startPrev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const [categories, thisMonth, prevMonth, examples] = await Promise.all([
      this.prisma.grammarCategory.findMany({ orderBy: { sort: 'asc' }, select: { code: true, label: true } }),
      this.prisma.grammarObservation.groupBy({ by: ['categoryCode'], where: { studentId, observedAt: { gte: startThis } }, _count: { _all: true } }),
      this.prisma.grammarObservation.groupBy({ by: ['categoryCode'], where: { studentId, observedAt: { gte: startPrev, lt: startThis } }, _count: { _all: true } }),
      this.prisma.grammarObservation.findMany({
        where: { studentId }, orderBy: { observedAt: 'desc' }, take: 40, select: { categoryCode: true, excerpt: true, correction: true, observedAt: true },
      }),
    ]);
    const cur = new Map(thisMonth.map((r) => [r.categoryCode, r._count._all]));
    const prev = new Map(prevMonth.map((r) => [r.categoryCode, r._count._all]));
    const rows = categories
      .map((c) => ({
        code: c.code, label: c.label, thisMonth: cur.get(c.code) ?? 0, lastMonth: prev.get(c.code) ?? 0,
        trend: monthlyTrend(cur.get(c.code) ?? 0, prev.get(c.code) ?? 0),
        examples: examples.filter((e) => e.categoryCode === c.code).slice(0, 2).map((e) => ({ excerpt: e.excerpt, correction: e.correction, at: e.observedAt })),
      }))
      .filter((r) => r.thisMonth + r.lastMonth > 0)
      .sort((a, b) => b.thisMonth - a.thisMonth || b.lastMonth - a.lastMonth);
    return {
      rows,
      total: rows.reduce((s, r) => s + r.thisMonth, 0),
      note: 'Counts come from AI feedback and teacher notes. They describe patterns in your writing, not an IELTS score.',
      since: new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10),
    };
  }
}

@Controller('me/grammar')
export class StudentGrammarController {
  constructor(private readonly grammar: GrammarService) {}
  @Get()
  dashboard(@CurrentUser() u: AuthUser) {
    if (!u.studentId) throw forbidden();
    return this.grammar.dashboard(u.studentId);
  }
}

@Module({ controllers: [StudentGrammarController], providers: [GrammarService], exports: [GrammarService] })
export class GrammarModule {}
