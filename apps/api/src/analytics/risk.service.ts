import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BandService } from './band.service';
import { evaluateRisk, type RiskResult, type RiskSignals } from './risk';
import { DEFAULT_RISK_THRESHOLDS, riskThresholdsSchema, type RiskThresholds } from './thresholds';

/** Enrolment statuses that count as "the student is on the course". One definition for all analytics. */
export const COHORT_STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED'] as const;

export interface StudentRisk extends RiskResult {
  studentId: string;
  batchId: string;
}

/**
 * Computes risk for a bounded list of students. Each source is read once for the whole list,
 * so the cost does not grow with one query per student.
 */
@Injectable()
export class RiskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bands: BandService,
    private readonly settings: SettingsService,
  ) {}

  async forCohort(studentIds: string[], now = new Date()): Promise<Map<string, StudentRisk>> {
    const out = new Map<string, StudentRisk>();
    if (studentIds.length === 0) return out;
    const thresholds = await this.thresholds();
    const window = thresholds.lateWindowDays;

    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId: { in: studentIds }, deletedAt: null, status: { in: [...COHORT_STATUSES] } },
      select: {
        id: true, studentId: true, batchId: true, courseVersionId: true, enrolledAt: true, accessStartsAt: true, createdAt: true,
        student: { select: { targetBand: true, ieltsExamDate: true, user: { select: { lastLoginAt: true } } } },
      },
    });
    if (enrollments.length === 0) return out;
    const sids = [...new Set(enrollments.map((e) => e.studentId))];
    const batchIds = [...new Set(enrollments.map((e) => e.batchId))];
    const versionIds = [...new Set(enrollments.map((e) => e.courseVersionId))];

    const [sessions, attendance, progress, attempts, submissions, overdueAssignments, bandMap] = await Promise.all([
      this.prisma.liveSession.findMany({ where: { batchId: { in: batchIds }, endsAt: { lt: now } }, select: { id: true, batchId: true, startsAt: true } }),
      this.prisma.attendance.findMany({ where: { studentId: { in: sids } }, select: { studentId: true, sessionId: true, status: true } }),
      this.prisma.contentProgress.groupBy({
        by: ['studentId'], where: { studentId: { in: sids }, status: { not: 'NOT_STARTED' } }, _max: { updatedAt: true },
      }),
      this.prisma.assessmentAttempt.groupBy({
        by: ['studentId'], where: { studentId: { in: sids }, submittedAt: { not: null } }, _max: { submittedAt: true },
      }),
      this.prisma.submission.findMany({
        where: { studentId: { in: sids } },
        select: { studentId: true, submittedAt: true, late: true, assignmentId: true, status: true },
      }),
      this.prisma.assignment.findMany({
        where: { dueAt: { lt: now }, contentItem: { section: { courseVersionId: { in: versionIds } } } },
        select: { id: true, contentItem: { select: { section: { select: { courseVersionId: true } } } } },
      }),
      this.bands.forCohort(sids),
    ]);

    const sessionById = new Map(sessions.map((s) => [s.id, s]));
    const attendanceByStudent = new Map<string, typeof attendance>();
    for (const a of attendance) {
      if (!attendanceByStudent.has(a.studentId)) attendanceByStudent.set(a.studentId, []);
      attendanceByStudent.get(a.studentId)!.push(a);
    }
    const progressAt = new Map(progress.map((p) => [p.studentId, p._max.updatedAt]));
    const attemptAt = new Map(attempts.map((p) => [p.studentId, p._max.submittedAt]));
    const submittedBy = new Map<string, typeof submissions>();
    for (const s of submissions) {
      if (!submittedBy.has(s.studentId)) submittedBy.set(s.studentId, []);
      submittedBy.get(s.studentId)!.push(s);
    }
    const assignmentsByVersion = new Map<string, string[]>();
    for (const a of overdueAssignments) {
      const v = a.contentItem.section.courseVersionId;
      if (!assignmentsByVersion.has(v)) assignmentsByVersion.set(v, []);
      assignmentsByVersion.get(v)!.push(a.id);
    }

    for (const e of enrollments) {
      const windowStart = (e.accessStartsAt ?? e.enrolledAt ?? e.createdAt).getTime();
      // Sessions that ran while this student was enrolled. A late joiner is not held against sessions before they joined.
      const heldIds = new Set(sessions.filter((s) => s.batchId === e.batchId && s.startsAt.getTime() >= windowStart).map((s) => s.id));
      const mine = (attendanceByStudent.get(e.studentId) ?? []).filter((a) => heldIds.has(a.sessionId));
      const attended = mine.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length;
      const excused = mine.filter((a) => a.status === 'EXCUSED').length;
      const attendedSessionTimes = mine
        .filter((a) => a.status === 'PRESENT' || a.status === 'LATE')
        .map((a) => sessionById.get(a.sessionId)?.startsAt.getTime() ?? 0);

      const subs = submittedBy.get(e.studentId) ?? [];
      const lateRecent = subs.filter((s) => s.late && s.submittedAt.getTime() >= now.getTime() - window * 86_400_000).length;
      const doneAssignments = new Set(subs.filter((s) => s.status === 'SUBMITTED' || s.status === 'GRADED').map((s) => s.assignmentId));
      const overdueCount = (assignmentsByVersion.get(e.courseVersionId) ?? []).filter((id) => !doneAssignments.has(id)).length;

      const candidates = [
        progressAt.get(e.studentId), attemptAt.get(e.studentId),
        ...subs.map((s) => s.submittedAt),
        ...attendedSessionTimes.map((t) => new Date(t)),
      ].filter((d): d is Date => d instanceof Date);
      const lastAcademicActivityAt = candidates.length ? new Date(Math.max(...candidates.map((d) => d.getTime()))) : null;

      const band = bandMap.get(e.studentId);
      const signals: RiskSignals = {
        enrolledAt: e.enrolledAt ?? e.createdAt,
        attendance: { attended, held: mine.length, excused },
        lastAcademicActivityAt,
        lastLoginAt: e.student.user.lastLoginAt,
        overdueCount,
        lateRecent,
        overall: band?.overall ?? null,
        overallPrevious: band?.overallPrevious ?? null,
        overallTrend: band?.overallTrend ?? 'INSUFFICIENT_DATA',
        target: e.student.targetBand === null ? null : Number(e.student.targetBand),
        examDate: e.student.ieltsExamDate,
      };
      out.set(e.studentId, { ...evaluateRisk(signals, thresholds, now), studentId: e.studentId, batchId: e.batchId });
    }
    return out;
  }

  async forStudent(studentId: string, now = new Date()): Promise<StudentRisk | null> {
    return (await this.forCohort([studentId], now)).get(studentId) ?? null;
  }

  /** Thresholds from settings, falling back to the defaults when unset or malformed. */
  private async thresholds(): Promise<RiskThresholds> {
    const raw = await this.settings.get('analytics.risk.thresholds');
    const parsed = riskThresholdsSchema.safeParse(raw);
    return parsed.success ? parsed.data : DEFAULT_RISK_THRESHOLDS;
  }
}
