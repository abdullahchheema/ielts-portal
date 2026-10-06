import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import { createHash } from 'node:crypto';
import { AppError, notFound } from '../common/app-error';
import { InsightsService } from '../insights/insights.service';
import { LEVEL_LABEL, WeaknessLevel } from '../insights/weakness';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from '../jobs/scheduler.service';
import { allocate, Candidate, planStatus } from './allocator';

const DAY = 86_400_000;
const MAX_DAYS = 56;
const DEFAULT_DAYS_WITHOUT_EXAM = 14;
export const VIEWS = ['today', 'week', 'upcoming', 'completed', 'overdue'] as const;
export type View = (typeof VIEWS)[number];

/** Academy calendar date, YYYY-MM-DD. Plans are kept on the academy's clock, not the browser's. */
export const academyDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(d);
const addDays = (ymd: string, n: number) => academyDate(new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY));

const STALE_AFTER_MS = 24 * 60 * 60_000;
const REFRESH_BATCH = 50;

@Injectable()
export class StudyPlanService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly insights: InsightsService,
    private readonly settings: SettingsService,
    private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit() {
    this.scheduler.register('study-plan.refresh', 6 * 60 * 60_000, () => this.refreshStale());
  }

  /** Scheduled: rebuilds plans older than a day, a bounded batch per run, so no single run becomes expensive. */
  async refreshStale(now = new Date()) {
    const stale = await this.prisma.studyPlan.findMany({
      where: { status: 'ACTIVE', generatedAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } },
      select: { studentId: true }, take: REFRESH_BATCH,
    });
    let refreshed = 0;
    for (const s of stale) {
      try { await this.recalculate(s.studentId); refreshed++; } catch { /* a student with a broken profile is skipped, not retried forever */ }
    }
    return { refreshed };
  }

  /**
   * Builds the plan from the student's current weaknesses, target and exam date. Returns the active plan unchanged
   * when nothing it depends on has moved. Otherwise the old plan is superseded and a new one takes its place.
   */
  async recalculate(studentId: string) {
    const profile = await this.prisma.studentProfile.findUnique({ where: { id: studentId }, select: { id: true, targetBand: true, ieltsExamDate: true } });
    if (!profile) throw notFound('Student');
    const minutesPerDay = await this.settings.get<number>('study_plan.minutes_per_day').catch(() => 60);
    const weak = await this.insights.weakness(studentId);
    const signals = await this.insights.readinessSignals(studentId);
    const today = academyDate(new Date());
    const examDay = profile.ieltsExamDate ? academyDate(profile.ieltsExamDate) : null;
    const daysLeft = examDay ? Math.max(0, Math.round((Date.parse(`${examDay}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY)) : null;
    const days = Math.min(MAX_DAYS, Math.max(1, daysLeft ?? DEFAULT_DAYS_WITHOUT_EXAM));

    const inputs = {
      target: profile.targetBand === null ? null : Number(profile.targetBand),
      exam: examDay, minutesPerDay, days,
      weak: weak.bySkill.map((g) => [g.key, g.level]),
      writing: weak.writingCriteria.map((c) => [c.key, c.level]),
      vocabDue: await this.dueCount(studentId),
      grammar: await this.topGrammar(studentId),
    };
    const inputsHash = createHash('sha256').update(JSON.stringify(inputs)).digest('hex').slice(0, 32);
    const active = await this.prisma.studyPlan.findFirst({ where: { studentId, status: 'ACTIVE' }, select: { id: true, inputsHash: true } });
    if (active && active.inputsHash === inputsHash) return this.view(studentId, 'today', today);

    const candidates = await this.candidates(studentId, weak, inputs.grammar);
    const planned = allocate(candidates, days, minutesPerDay);
    const estimates = Object.values(signals.skillEstimates).filter((v): v is number => v !== null);
    const estimate = estimates.length === 4 ? estimates.reduce((a, b) => a + b, 0) / 4 : null;
    const gapBands = profile.targetBand === null || estimate === null ? null : Number(profile.targetBand) - estimate;
    const minutesPlanned = planned.reduce((s, d) => s + d.minutes, 0);
    const status = planStatus({ gapBands, daysLeft, minutesPlanned, minutesPerDay });
    const weakNames = weak.bySkill.filter((g) => g.level === 'HIGH_RISK' || g.level === 'NEEDS_PRACTICE').map((g) => g.key.toLowerCase());
    const summary = [
      profile.targetBand === null ? 'No target band is set yet.' : `Target band ${Number(profile.targetBand)}.`,
      daysLeft === null ? 'No exam date is set, so the plan covers two weeks.' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} to your exam.`,
      weakNames.length ? `Focus first on ${weakNames.join(' and ')}.` : 'No skill is currently flagged as weak.',
    ].join(' ');

    return this.prisma.$transaction(async (tx) => {
      await tx.studyPlan.updateMany({ where: { studentId, status: 'ACTIVE' }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
      const plan = await tx.studyPlan.create({
        data: { studentId, status: 'ACTIVE', planStatus: status, summary, inputsHash, minutesPerDay },
      });
      const weekStarts = new Map<number, string>();
      for (const day of planned) {
        const w = Math.floor(day.dayIndex / 7);
        if (!weekStarts.has(w)) weekStarts.set(w, addDays(today, w * 7));
      }
      const weekIds = new Map<number, string>();
      for (const [w, start] of weekStarts) {
        const row = await tx.studyPlanWeek.create({ data: { planId: plan.id, weekIndex: w, startsOn: new Date(`${start}T00:00:00Z`) } });
        weekIds.set(w, row.id);
      }
      for (const day of planned) {
        const w = Math.floor(day.dayIndex / 7);
        const dayRow = await tx.studyPlanDay.create({
          data: { planId: plan.id, weekId: weekIds.get(w)!, dayDate: new Date(`${addDays(today, day.dayIndex)}T00:00:00Z`), minutes: day.minutes },
        });
        for (const t of day.tasks) {
          await tx.studyPlanTask.create({
            data: {
              planId: plan.id, dayId: dayRow.id, studentId, skill: t.skill, kind: t.kind, refType: t.refType, refId: t.refId,
              title: t.title, minutes: t.minutes, sort: t.sort, rationale: t.rationale,
            },
          });
        }
      }
      return this.view(studentId, 'today', today, tx);
    });
  }

  private async dueCount(studentId: string) {
    return this.prisma.studentVocabulary.count({ where: { studentId, nextReviewAt: { lte: new Date() } } });
  }

  private async topGrammar(studentId: string): Promise<{ code: string; label: string } | null> {
    const since = new Date(Date.now() - 30 * DAY);
    const rows = await this.prisma.grammarObservation.groupBy({ by: ['categoryCode'], where: { studentId, observedAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { categoryCode: 'desc' } }, take: 1 });
    if (!rows[0]) return null;
    const cat = await this.prisma.grammarCategory.findUnique({ where: { code: rows[0].categoryCode }, select: { label: true } });
    return { code: rows[0].categoryCode, label: cat?.label ?? rows[0].categoryCode };
  }

  /**
   * Practice candidates. Each one points at a record that exists right now. If no suitable record exists, no
   * candidate is created: a plan never sends a student to a placeholder.
   */
  private async candidates(studentId: string, weak: Awaited<ReturnType<InsightsService['weakness']>>, grammar: { code: string; label: string } | null): Promise<Candidate[]> {
    const out: Candidate[] = [];
    const weight = (l: WeaknessLevel) => (l === 'HIGH_RISK' ? 5 : l === 'NEEDS_PRACTICE' ? 3 : 0);
    for (const g of weak.bySkill) {
      const w = weight(g.level as WeaknessLevel);
      if (!w) continue;
      const pct = g.accuracy === null ? '—' : `${Math.round(g.accuracy * 100)}%`;
      const why = `${LEVEL_LABEL[g.level as WeaknessLevel]}: ${g.key.toLowerCase()} accuracy is ${pct} across ${g.total} answers.`;
      if (g.key === 'LISTENING' || g.key === 'READING') {
        const set = await this.prisma.questionSet.findFirst({ where: { skill: g.key, status: 'PUBLISHED', studentFacing: true }, orderBy: { updatedAt: 'desc' }, select: { id: true, title: true, timeEstimateMin: true } });
        if (set) out.push({ key: `skill:${g.key}`, skill: g.key, kind: 'practice', refType: 'QUESTION_SET', refId: set.id, title: `Practice: ${set.title}`, minutes: set.timeEstimateMin ?? 20, weight: w, rationale: why });
      }
      if (g.key === 'WRITING') {
        const q = await this.prisma.question.findFirst({ where: { ieltsType: 'WRITING_TASK2', deletedAt: null, questionSet: { status: 'PUBLISHED', studentFacing: true } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
        if (q) out.push({ key: 'skill:WRITING', skill: 'WRITING', kind: 'practice', refType: 'WRITING_TASK', refId: q.id, title: 'Write a Task 2 essay and get feedback', minutes: 40, weight: w, rationale: why });
      }
      if (g.key === 'SPEAKING') {
        const q = await this.prisma.question.findFirst({ where: { ieltsType: 'SPEAKING_PART2', deletedAt: null, questionSet: { status: 'PUBLISHED', studentFacing: true } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
        if (q) out.push({ key: 'skill:SPEAKING', skill: 'SPEAKING', kind: 'practice', refType: 'SPEAKING_PART', refId: q.id, title: 'Record a Part 2 answer', minutes: 15, weight: w, rationale: why });
      }
    }
    const due = await this.prisma.studentVocabulary.findFirst({ where: { studentId, nextReviewAt: { lte: new Date() } }, orderBy: { nextReviewAt: 'asc' }, select: { id: true, item: { select: { word: true } } } });
    if (due) out.push({ key: 'vocab:due', skill: 'VOCABULARY', kind: 'review', refType: 'VOCABULARY_REVIEW', refId: due.id, title: `Review your due words (starting with “${due.item.word}”)`, minutes: 10, weight: 2, rationale: 'Words you saved are due for review. Spaced review keeps them.' });
    if (grammar) {
      // Reuse the writing task already chosen for a weak writing skill; otherwise look for one.
      const existing = out.find((c) => c.refType === 'WRITING_TASK');
      const refId = existing?.refId ?? (await this.prisma.question.findFirst({
        where: { ieltsType: 'WRITING_TASK2', deletedAt: null, questionSet: { status: 'PUBLISHED', studentFacing: true } }, orderBy: { createdAt: 'desc' }, select: { id: true },
      }))?.id;
      if (refId) out.push({ key: `grammar:${grammar.code}`, skill: 'GRAMMAR', kind: 'practice', refType: 'WRITING_TASK', refId, title: `Edit an essay with a focus on ${grammar.label.toLowerCase()}`, minutes: 20, weight: 2.5, rationale: `${grammar.label} is your most frequent grammar issue this month.` });
    }
    return out;
  }

  /** The plan, filtered to one of the views. `today` is the academy date. */
  async view(studentId: string, view: View, today = academyDate(new Date()), db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const plan = await db.studyPlan.findFirst({
      where: { studentId, status: 'ACTIVE' },
      select: { id: true, planStatus: true, summary: true, minutesPerDay: true, generatedAt: true },
    });
    if (!plan) return { plan: null, view, tasks: [], counts: { today: 0, week: 0, upcoming: 0, completed: 0, overdue: 0 } };
    const rows = await db.studyPlanTask.findMany({
      where: { planId: plan.id },
      orderBy: [{ day: { dayDate: 'asc' } }, { sort: 'asc' }],
      select: { id: true, skill: true, kind: true, refType: true, refId: true, title: true, minutes: true, status: true, rationale: true, completedAt: true, day: { select: { dayDate: true } } },
    });
    const withDay = rows.map((r) => ({ ...r, date: academyDate(r.day.dayDate) }));
    const weekEnd = addDays(today, 6);
    const belongs = (t: (typeof withDay)[number]) => {
      if (view === 'today') return t.date === today && t.status === 'PENDING';
      if (view === 'week') return t.date >= today && t.date <= weekEnd && t.status === 'PENDING';
      if (view === 'upcoming') return t.date > today && t.status === 'PENDING';
      if (view === 'completed') return t.status === 'DONE';
      return t.date < today && t.status === 'PENDING';
    };
    const counts = {
      today: withDay.filter((t) => t.date === today && t.status === 'PENDING').length,
      week: withDay.filter((t) => t.date >= today && t.date <= weekEnd && t.status === 'PENDING').length,
      upcoming: withDay.filter((t) => t.date > today && t.status === 'PENDING').length,
      completed: withDay.filter((t) => t.status === 'DONE').length,
      overdue: withDay.filter((t) => t.date < today && t.status === 'PENDING').length,
    };
    return {
      plan: { id: plan.id, status: plan.planStatus, summary: plan.summary, minutesPerDay: plan.minutesPerDay, generatedAt: plan.generatedAt },
      view,
      today,
      minutesToday: withDay.filter((t) => t.date === today && t.status === 'PENDING').reduce((s, t) => s + t.minutes, 0),
      tasks: withDay.filter(belongs).map(({ day: _d, ...t }) => t),
      counts,
    };
  }

  /** Marks one of the student's own tasks done. Other students' tasks are simply not found. */
  async complete(studentId: string, taskId: string) {
    const r = await this.prisma.studyPlanTask.updateMany({ where: { id: taskId, studentId, status: 'PENDING' }, data: { status: 'DONE', completedAt: new Date() } });
    if (r.count === 0) {
      const exists = await this.prisma.studyPlanTask.findFirst({ where: { id: taskId, studentId }, select: { status: true } });
      if (!exists) throw notFound('Task');
      throw new AppError('CONFLICT', 409, 'This task is already complete.');
    }
    return { ok: true };
  }
}
