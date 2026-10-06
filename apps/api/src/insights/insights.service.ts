import { Injectable } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import { createHash } from 'node:crypto';
import { notFound } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { DEFAULT_READINESS_WEIGHTS, readiness, ReadinessSignals, spreadOf } from './readiness';
import { AnsweredItem, criterionWeakness, DEFAULT_WEAKNESS_THRESHOLDS, weaknessReport, WeaknessThresholds } from './weakness';
import { planFor, SKILLS, Skill } from './target-band';
import { INSIGHT_DEFAULTS } from './settings';

const DAY = 86_400_000;

/** Calculations that read many rows. Each result is cached as a snapshot and recomputed only when its inputs change. */
@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService) {}

  // ───────── snapshots ─────────
  /** Returns the cached payload when `inputKey` matches the stored hash; otherwise recalculates and stores it. */
  async snapshot<T>(studentId: string, kind: string, inputKey: string, compute: () => Promise<T>): Promise<T> {
    const inputsHash = createHash('sha256').update(inputKey).digest('hex').slice(0, 32);
    const existing = await this.prisma.studentSnapshot.findUnique({ where: { studentId_kind_periodKey: { studentId, kind, periodKey: 'current' } } });
    if (existing && existing.inputsHash === inputsHash) return existing.payload as T;
    const payload = await compute();
    await this.prisma.studentSnapshot.upsert({
      where: { studentId_kind_periodKey: { studentId, kind, periodKey: 'current' } },
      create: { studentId, kind, periodKey: 'current', payload: payload as Prisma.InputJsonValue, inputsHash },
      update: { payload: payload as Prisma.InputJsonValue, inputsHash, computedAt: new Date() },
    });
    return payload;
  }

  /** A cheap fingerprint of the rows a snapshot depends on. Changes whenever a relevant row is added or updated. */
  private async fingerprint(studentId: string): Promise<string> {
    const [answers, attempts, evals, submissions] = await Promise.all([
      this.prisma.attemptAnswer.aggregate({ where: { attempt: { studentId } }, _count: { _all: true }, _max: { updatedAt: true } }),
      this.prisma.assessmentAttempt.aggregate({ where: { studentId }, _count: { _all: true }, _max: { submittedAt: true } }),
      this.prisma.writingEvaluation.count({ where: { response: { studentId } } }),
      this.prisma.submission.aggregate({ where: { studentId }, _count: { _all: true }, _max: { gradedAt: true } }),
    ]);
    return [answers._count._all, answers._max.updatedAt?.toISOString(), attempts._count._all, attempts._max.submittedAt?.toISOString(), evals, submissions._count._all, submissions._max.gradedAt?.toISOString()].join('|');
  }

  // ───────── weakness ─────────
  async weakness(studentId: string) {
    const t = await this.thresholds();
    return this.snapshot(studentId, 'weakness', `${await this.fingerprint(studentId)}|${JSON.stringify(t)}`, () => this.computeWeakness(studentId, t));
  }

  private async thresholds(): Promise<WeaknessThresholds> {
    return this.settings.get<WeaknessThresholds>('insights.weakness.thresholds').catch(() => DEFAULT_WEAKNESS_THRESHOLDS);
  }

  private async computeWeakness(studentId: string, t: WeaknessThresholds) {
    const rows = await this.prisma.attemptAnswer.findMany({
      where: { attempt: { studentId, status: { in: ['AUTO_GRADED', 'GRADED'] } }, isCorrect: { not: null } },
      select: {
        isCorrect: true,
        questionVersion: {
          select: {
            question: {
              select: {
                ieltsType: true,
                section: { select: { sequence: true, version: { select: { assessment: { select: { skill: true } } } } } },
                questionSet: { select: { skill: true, topic: true, difficulty: true } },
              },
            },
          },
        },
      },
      take: 5000,
    });
    const items: AnsweredItem[] = rows.map((r) => {
      const q = r.questionVersion.question;
      return {
        skill: q.questionSet?.skill ?? q.section?.version.assessment.skill ?? 'READING',
        ieltsType: q.ieltsType ?? null,
        topic: q.questionSet?.topic ?? null,
        difficulty: q.questionSet?.difficulty ?? 3,
        section: q.section ? q.section.sequence + 1 : null,
        isCorrect: r.isCorrect === true,
      };
    });
    const writing = await this.prisma.writingEvaluation.findMany({
      where: { response: { studentId } }, orderBy: { createdAt: 'desc' }, take: 1,
      select: { criteria: true },
    });
    const target = await this.targetBand(studentId);
    const writingCriteria = writing[0] ? criterionWeakness((writing[0].criteria as { key: string; score: number | null }[]), target) : [];
    return { ...weaknessReport(items, t), writingCriteria, answered: items.length };
  }

  // ───────── readiness ─────────
  async readiness(studentId: string) {
    const weights = await this.settings.get<typeof DEFAULT_READINESS_WEIGHTS>('insights.readiness.weights').catch(() => INSIGHT_DEFAULTS['insights.readiness.weights']);
    return this.snapshot(studentId, 'readiness', `${await this.fingerprint(studentId)}|${JSON.stringify(weights)}`, async () => {
      const signals = await this.readinessSignals(studentId);
      return readiness(signals, weights);
    });
  }

  async readinessSignals(studentId: string): Promise<ReadinessSignals> {
    const profile = await this.prisma.studentProfile.findUniqueOrThrow({ where: { id: studentId }, select: { targetBand: true } });
    const since60 = new Date(Date.now() - 60 * DAY);
    const [attempts, writing, mocks, enrollments, attendance, due, submitted] = await Promise.all([
      this.prisma.assessmentAttempt.findMany({
        where: { studentId, status: { in: ['AUTO_GRADED', 'GRADED'] }, bandScore: { not: null } },
        orderBy: { submittedAt: 'desc' }, take: 12, select: { bandScore: true, submittedAt: true, assessment: { select: { skill: true, type: true } } },
      }),
      this.prisma.writingEvaluation.findMany({ where: { response: { studentId }, estimatedBand: { not: null } }, orderBy: { createdAt: 'desc' }, take: 6, select: { estimatedBand: true } }),
      this.prisma.assessmentAttempt.count({ where: { studentId, status: { in: ['AUTO_GRADED', 'GRADED'] }, submittedAt: { gte: since60 }, assessment: { type: 'MOCK' } } }),
      this.prisma.enrollment.findMany({ where: { studentId, status: 'ACTIVE', deletedAt: null }, select: { progressPercent: true, courseVersionId: true } }),
      this.prisma.attendance.groupBy({ by: ['status'], where: { studentId }, _count: { _all: true } }),
      this.prisma.assignment.count({ where: { dueAt: { lt: new Date() }, contentItem: { section: { version: { enrollments: { some: { studentId, status: 'ACTIVE' } } } } } } }),
      this.prisma.submission.count({ where: { studentId, status: { in: ['SUBMITTED', 'GRADED'] } } }),
    ]);

    const recentScores: { skill: string; band: number }[] = [
      ...attempts.map((a) => ({ skill: a.assessment.skill ?? 'READING', band: Number(a.bandScore) })),
      ...writing.map((w) => ({ skill: 'WRITING', band: Number(w.estimatedBand) })),
    ];
    const skillEstimates: Record<string, number | null> = {};
    for (const s of SKILLS) {
      const latest = recentScores.find((r) => r.skill === s);
      skillEstimates[s] = latest ? latest.band : null;
    }
    const ordered = attempts.map((a) => Number(a.bandScore));
    const half = Math.floor(ordered.length / 2);
    const newer = ordered.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(1, half);
    const older = ordered.slice(half).reduce((a, b) => a + b, 0) / Math.max(1, ordered.length - half);
    const trend: ReadinessSignals['trend'] = ordered.length < 4 ? 'INSUFFICIENT_DATA' : newer - older >= 0.5 ? 'IMPROVING' : older - newer >= 0.5 ? 'DECLINING' : 'STABLE';
    const present = attendance.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').reduce((s, a) => s + a._count._all, 0);
    const held = attendance.filter((a) => a.status !== 'EXCUSED').reduce((s, a) => s + a._count._all, 0);
    const completion = enrollments.length ? enrollments.reduce((s, e) => s + Number(e.progressPercent), 0) / enrollments.length / 100 : null;

    return {
      recentScores,
      target: profile.targetBand === null ? null : Number(profile.targetBand),
      mockCountLast60Days: mocks,
      bandSpread: spreadOf(recentScores.map((r) => r.band)),
      completion,
      attendance: held > 0 ? present / held : null,
      assignments: due > 0 ? Math.min(1, submitted / due) : null,
      skillEstimates,
      trend,
    };
  }

  // ───────── target band ─────────
  /** The student's target overall band, or null when none is set. */
  async targetBand(studentId: string): Promise<number | null> {
    const p = await this.prisma.studentProfile.findUnique({ where: { id: studentId }, select: { targetBand: true } });
    return p?.targetBand === null || p?.targetBand === undefined ? null : Number(p.targetBand);
  }

  async targetPlan(studentId: string, priorities?: Partial<Record<Skill, number>>) {
    const profile = await this.prisma.studentProfile.findUnique({ where: { id: studentId }, select: { targetBand: true, ieltsExamDate: true } });
    if (!profile) throw notFound('Student');
    if (profile.targetBand === null) return { labelled: 'Set a target band in your profile to see a plan.', target: null };
    const signals = await this.readinessSignals(studentId);
    const current = Object.fromEntries(SKILLS.map((s) => [s, signals.skillEstimates[s]])) as Record<Skill, number | null>;
    const weeksToExam = profile.ieltsExamDate ? Math.max(1, Math.ceil((profile.ieltsExamDate.getTime() - Date.now()) / (7 * DAY))) : null;
    return planFor({ current, target: Number(profile.targetBand), weeksToExam, priorities });
  }

  /** Assignments due in an active course that the student has not yet submitted. */
  async pendingAssignments(studentId: string): Promise<number> {
    const [total, done] = await Promise.all([
      this.prisma.assignment.count({ where: { contentItem: { section: { version: { enrollments: { some: { studentId, status: 'ACTIVE' } } } } } } }),
      this.prisma.submission.count({ where: { studentId, status: { in: ['SUBMITTED', 'GRADED'] } } }),
    ]);
    return Math.max(0, total - done);
  }

  // ───────── home ─────────
  /** Everything the student dashboard needs, from snapshots and light queries. Makes no AI calls. */
  async home(studentId: string) {
    const profile = await this.prisma.studentProfile.findUniqueOrThrow({
      where: { id: studentId },
      select: { firstName: true, currentBand: true, targetBand: true, ieltsExamDate: true, userId: true },
    });
    const now = new Date();
    const [readinessOut, weak, pending, nextSession, recent, mocks, streakRows] = await Promise.all([
      this.readiness(studentId),
      this.weakness(studentId),
      this.pendingAssignments(studentId),
      this.prisma.liveSession.findFirst({
        where: { startsAt: { gte: now }, batch: { enrollments: { some: { studentId, status: 'ACTIVE' } } } },
        orderBy: { startsAt: 'asc' }, select: { id: true, topic: true, startsAt: true, endsAt: true },
      }),
      this.prisma.assessmentAttempt.findMany({
        where: { studentId, status: { in: ['AUTO_GRADED', 'GRADED'] }, bandScore: { not: null } },
        orderBy: { submittedAt: 'desc' }, take: 5, select: { id: true, bandScore: true, submittedAt: true, assessment: { select: { title: true, skill: true } } },
      }),
      this.prisma.assessmentAttempt.findMany({
        where: { studentId, status: { in: ['AUTO_GRADED', 'GRADED'] }, assessment: { type: 'MOCK' } },
        orderBy: { submittedAt: 'desc' }, take: 3, select: { id: true, bandScore: true, submittedAt: true, assessment: { select: { title: true } } },
      }),
      this.prisma.assessmentAttempt.findMany({
        where: { studentId, submittedAt: { gte: new Date(Date.now() - 60 * DAY) } }, select: { submittedAt: true }, take: 500,
      }),
    ]);
    const days = new Set(streakRows.map((r) => r.submittedAt?.toISOString().slice(0, 10)).filter(Boolean));
    let streak = 0;
    for (let d = new Date(); days.has(d.toISOString().slice(0, 10)); d = new Date(d.getTime() - DAY)) streak++;
    const examDays = profile.ieltsExamDate ? Math.ceil((profile.ieltsExamDate.getTime() - now.getTime()) / DAY) : null;
    const weakTop = [...weak.bySkill, ...weak.byQuestionType].filter((g) => g.level === 'HIGH_RISK' || g.level === 'NEEDS_PRACTICE').slice(0, 3);
    return {
      greetingName: profile.firstName,
      target: profile.targetBand === null ? null : Number(profile.targetBand),
      estimated: profile.currentBand === null ? null : Number(profile.currentBand),
      examDate: profile.ieltsExamDate,
      daysRemaining: examDays,
      readiness: readinessOut,
      weakAreas: weakTop,
      pendingWork: pending,
      nextClass: nextSession,
      recentPerformance: recent.map((r) => ({ id: r.id, title: r.assessment.title, skill: r.assessment.skill, band: Number(r.bandScore), at: r.submittedAt })),
      mockHistory: mocks.map((m) => ({ id: m.id, title: m.assessment.title, band: Number(m.bandScore), at: m.submittedAt })),
      streakDays: streak,
    };
  }
}
