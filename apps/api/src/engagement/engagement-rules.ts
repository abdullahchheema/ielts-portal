/**
 * Engagement, attendance and leaderboard rules as pure functions. No database, no clock: `now` is passed in.
 */

// ───────── attendance ─────────
export type MarkStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
export interface MarkedSession { startsAt: Date; status: MarkStatus | null }

export interface AttendanceThresholds { lowPercent: number; consecutiveMisses: number; missesInSevenDays: number }
export const DEFAULT_ATTENDANCE_RULES: AttendanceThresholds = { lowPercent: 75, consecutiveMisses: 2, missesInSevenDays: 3 };

const DAY = 86_400_000;
export const isMiss = (s: MarkStatus | null) => s === 'ABSENT';

/** Attendance share, counting late as present and excluding excused absences. Null when nothing is countable. */
export function attendancePercent(rows: MarkedSession[]): number | null {
  const countable = rows.filter((r) => r.status !== null && r.status !== 'EXCUSED');
  if (countable.length === 0) return null;
  const present = countable.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
  return Math.round((present / countable.length) * 100);
}

/** Consecutive attended sessions counting back from the most recent one. Excused sessions neither add nor break a streak. */
export function attendanceStreak(rows: MarkedSession[]): number {
  const ordered = [...rows].filter((r) => r.status !== null).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  let streak = 0;
  for (const r of ordered) {
    if (r.status === 'EXCUSED') continue;
    if (r.status === 'PRESENT' || r.status === 'LATE') streak++;
    else break;
  }
  return streak;
}

/**
 * The warnings that apply right now. Each has a window key so the same rule raises at most once per window:
 * the whole term for the percentage rule, the miss run's last session for consecutive misses, and the calendar
 * week for the seven-day rule.
 */
export function attendanceWarnings(rows: MarkedSession[], t: AttendanceThresholds, now: Date) {
  const out: { rule: string; windowKey: string; message: string }[] = [];
  const pct = attendancePercent(rows);
  if (pct !== null && pct < t.lowPercent) {
    out.push({ rule: 'LOW_ATTENDANCE', windowKey: 'term', message: `Attendance is ${pct}%, below the ${t.lowPercent}% threshold.` });
  }
  const ordered = [...rows].filter((r) => r.status !== null && r.status !== 'EXCUSED').sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  let run = 0;
  let runEnd: Date | null = null;
  for (const r of ordered) {
    if (isMiss(r.status)) { run++; runEnd = r.startsAt; } else run = 0;
    if (run >= t.consecutiveMisses && runEnd) {
      out.push({ rule: 'CONSECUTIVE_MISSES', windowKey: runEnd.toISOString().slice(0, 10), message: `${run} classes missed in a row.` });
    }
  }
  const weekAgo = now.getTime() - 7 * DAY;
  const recentMisses = ordered.filter((r) => isMiss(r.status) && r.startsAt.getTime() >= weekAgo && r.startsAt.getTime() <= now.getTime()).length;
  if (recentMisses >= t.missesInSevenDays) {
    out.push({ rule: 'MISSES_7_DAYS', windowKey: isoWeek(now), message: `${recentMisses} classes missed in the last seven days.` });
  }
  return out;
}

/** ISO week key, e.g. 2026-W41. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / DAY + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ───────── engagement ─────────
export type EngagementStatus = 'ACTIVE' | 'AT_RISK' | 'INACTIVE' | 'REACTIVATED';

export interface EngagementSignals {
  daysSinceActivity: number | null;
  daysSinceLogin: number | null;
  activityLabel: string | null;
  attendancePercent: number | null;
  overdueAssignments: number;
  previous: EngagementStatus | null;
}
export interface EngagementThresholds { atRiskDays: number; inactiveDays: number }
export const DEFAULT_ENGAGEMENT: EngagementThresholds = { atRiskDays: 7, inactiveDays: 14 };

/** Status and the plain-language reasons. REACTIVATED marks a return from AT_RISK or INACTIVE. */
export function engagementStatus(s: EngagementSignals, t: EngagementThresholds = DEFAULT_ENGAGEMENT): { status: EngagementStatus; reasons: string[] } {
  const reasons: string[] = [];
  const idle = s.daysSinceActivity;
  let level: 'ACTIVE' | 'AT_RISK' | 'INACTIVE' = 'ACTIVE';
  if (idle !== null && idle >= t.inactiveDays) level = 'INACTIVE';
  else if (idle !== null && idle >= t.atRiskDays) level = 'AT_RISK';
  if (idle !== null && level !== 'ACTIVE') reasons.push(`Student has been inactive for ${idle} days.`);
  if (s.activityLabel && level !== 'ACTIVE') reasons.push(`Last activity: ${s.activityLabel}.`);
  if (s.attendancePercent !== null && s.attendancePercent < 75) reasons.push(`Attendance: ${s.attendancePercent}%.`);
  if (s.overdueAssignments > 0) reasons.push(`${s.overdueAssignments} assignment${s.overdueAssignments === 1 ? '' : 's'} past due and not submitted.`);
  const returned = level === 'ACTIVE' && (s.previous === 'AT_RISK' || s.previous === 'INACTIVE');
  return { status: returned ? 'REACTIVATED' : level, reasons };
}

/** RED / YELLOW / GREEN for the staff alert, from the same signals. */
export function alertLevel(status: EngagementStatus, attendancePercent: number | null): 'RED' | 'YELLOW' | 'GREEN' {
  if (status === 'INACTIVE' || (status === 'AT_RISK' && attendancePercent !== null && attendancePercent < 75)) return 'RED';
  if (status === 'AT_RISK') return 'YELLOW';
  return 'GREEN';
}

// ───────── leaderboards ─────────
export interface LeaderboardInput {
  studentId: string;
  firstName: string;
  lastName: string;
  optedOut: boolean;
  practiceAnswers: number;
  mocksCompleted: number;
  attendance: number | null;
  assignmentsSubmitted: number;
  improvement: number | null;
}
export const LEADERBOARD_WEIGHTS = { practice: 1, mocks: 5, attendance: 2, assignments: 3, improvement: 4 };

/** Points from meaningful academic activity only. Opted-out students are excluded from the ranking entirely. */
export function leaderboardEntries(rows: LeaderboardInput[]) {
  const scored = rows.filter((r) => !r.optedOut).map((r) => {
    const points = LEADERBOARD_WEIGHTS.practice * Math.min(r.practiceAnswers, 200)
      + LEADERBOARD_WEIGHTS.mocks * r.mocksCompleted
      + LEADERBOARD_WEIGHTS.attendance * ((r.attendance ?? 0) / 10)
      + LEADERBOARD_WEIGHTS.assignments * r.assignmentsSubmitted
      + LEADERBOARD_WEIGHTS.improvement * Math.max(0, r.improvement ?? 0) * 2;
    return { studentId: r.studentId, name: `${r.firstName.trim()} ${r.lastName.trim().charAt(0).toUpperCase()}.`, points: Math.round(points * 10) / 10 };
  });
  return scored.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)).map((e, i) => ({ ...e, rank: i + 1 }));
}

/** Calendar period keys in UTC: the ISO week for weekly, the year and month for monthly. */
export const periodKey = (type: 'WEEKLY' | 'MONTHLY', d: Date) => (type === 'WEEKLY' ? isoWeek(d) : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
