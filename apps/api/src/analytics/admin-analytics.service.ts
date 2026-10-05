import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../common/app-error';
import { BandService } from './band.service';
import { COHORT_STATUSES, RiskService, type StudentRisk } from './risk.service';
import { type RiskLevel } from './risk';

/** Smallest group an average may describe. Below this, the figure would reveal individual students. */
export const MIN_GROUP = 3;
/** Largest cohort loaded in one request. Beyond this the view must be narrowed by a filter. */
export const COHORT_CAP = 2000;

export interface CohortFilter { batchId?: string; search?: string; level?: RiskLevel }

export interface CohortRow {
  studentId: string;
  name: string;
  email: string;
  batchId: string;
  batchName: string;
  level: RiskLevel;
  reasons: string[];
  estimatedOverall: number | null;
  overallStatus: string;
  target: number | null;
  gapToTarget: number | null;
  attendancePercent: number | null;
  daysSinceAcademicActivity: number | null;
}

@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly prisma: PrismaService, private readonly risk: RiskService, private readonly bands: BandService) {}

  /** One row per student on the course, with risk and estimated band. Filters narrow the cohort before any risk is computed. */
  async cohort(filter: CohortFilter, now = new Date()): Promise<{ rows: CohortRow[]; truncated: boolean }> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        deletedAt: null,
        status: { in: [...COHORT_STATUSES] },
        ...(filter.batchId ? { batchId: filter.batchId } : {}),
        ...(filter.search ? {
          student: { OR: [
            { firstName: { contains: filter.search, mode: 'insensitive' } },
            { lastName: { contains: filter.search, mode: 'insensitive' } },
            { user: { email: { contains: filter.search, mode: 'insensitive' } } },
          ] },
        } : {}),
      },
      select: {
        studentId: true, batchId: true, status: true,
        batch: { select: { name: true } },
        student: { select: { firstName: true, lastName: true, user: { select: { email: true } } } },
      },
      orderBy: { enrolledAt: 'asc' },
      take: COHORT_CAP + 1,
    });
    const truncated = enrollments.length > COHORT_CAP;
    // A student may hold more than one enrolment; the first (oldest) represents them in the cohort.
    const firstByStudent = new Map<string, (typeof enrollments)[number]>();
    for (const e of enrollments.slice(0, COHORT_CAP)) if (!firstByStudent.has(e.studentId)) firstByStudent.set(e.studentId, e);
    const ids = [...firstByStudent.keys()];
    if (ids.length === 0) return { rows: [], truncated };

    const risks = await this.risk.forCohort(ids, now);
    const rows: CohortRow[] = [];
    for (const id of ids) {
      const r = risks.get(id);
      const e = firstByStudent.get(id)!;
      if (!r) continue;
      if (filter.level && r.level !== filter.level) continue;
      rows.push(rowOf(id, e, r));
    }
    return { rows, truncated };
  }

  /** Students who need attention first: RED before YELLOW, then the most recent inactivity. */
  async needsAttention(take = 25) {
    const { rows } = await this.cohort({});
    const counts = { red: 0, yellow: 0, green: 0 };
    for (const r of rows) counts[r.level === 'RED' ? 'red' : r.level === 'YELLOW' ? 'yellow' : 'green'] += 1;
    const flagged = rows.filter((r) => r.level !== 'GREEN').sort((a, b) => (a.level === b.level ? 0 : a.level === 'RED' ? -1 : 1));
    return { counts, items: flagged.slice(0, take) };
  }

  /** Academy KPIs. Averages are suppressed when the group is too small to hide individuals. */
  async kpis(now = new Date()) {
    const { rows } = await this.cohort({}, now);
    const green = rows.filter((r) => r.level === 'GREEN').length;
    const yellow = rows.filter((r) => r.level === 'YELLOW').length;
    const red = rows.filter((r) => r.level === 'RED').length;
    const attendance = rows.map((r) => r.attendancePercent).filter((p): p is number => p !== null);
    const bands = rows.map((r) => r.estimatedOverall).filter((b): b is number => b !== null);
    const suppress = (values: number[]) => (values.length >= MIN_GROUP ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10 : null);
    return {
      students: { total: rows.length },
      risk: { green, yellow, red },
      attendance: { averagePercent: suppress(attendance), measured: attendance.length },
      bands: { averageOverall: suppress(bands), withFullData: bands.length },
      suppressed: attendance.length < MIN_GROUP || bands.length < MIN_GROUP,
    };
  }

  /** Student 360, analytics part: estimated bands per skill and the risk explanation. */
  async studentAnalytics(studentId: string, now = new Date()) {
    const profile = await this.prisma.studentProfile.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!profile) throw notFound('Student');
    const [band, risk] = await Promise.all([this.bands.forStudent(studentId), this.risk.forStudent(studentId, now)]);
    return {
      studentId,
      band: {
        overall: band.overall, overallPrevious: band.overallPrevious, overallTrend: band.overallTrend,
        overallStatus: band.overallStatus, missingSkills: band.missingSkills, target: band.target, gapToTarget: band.gapToTarget,
        skills: Object.fromEntries(Object.entries(band.skills).map(([k, v]) => [k, { estimated: v.estimated, previous: v.previous, trend: v.trend, pointCount: v.pointCount, latest: v.latest, best: v.best, target: v.target, gapToTarget: v.gapToTarget }])),
      },
      risk: risk ? { level: risk.level, reasons: risk.reasons, positives: risk.positives, signals: { attendancePercent: risk.signals.attendancePercent, daysSinceAcademicActivity: risk.signals.daysSinceAcademicActivity, overdueCount: risk.signals.overdueCount, lateRecent: risk.signals.lateRecent } } : null,
    };
  }
}

function rowOf(studentId: string, e: { batchId: string; batch: { name: string }; student: { firstName: string; lastName: string; user: { email: string } } }, r: StudentRisk): CohortRow {
  return {
    studentId,
    name: `${e.student.firstName} ${e.student.lastName}`.trim(),
    email: e.student.user.email,
    batchId: e.batchId,
    batchName: e.batch.name,
    level: r.level,
    reasons: r.reasons,
    estimatedOverall: r.signals.overall,
    overallStatus: r.signals.overall === null ? 'INSUFFICIENT_DATA' : 'OK',
    target: r.signals.target,
    gapToTarget: r.signals.gapToTarget,
    attendancePercent: r.signals.attendancePercent,
    daysSinceAcademicActivity: r.signals.daysSinceAcademicActivity,
  };
}
