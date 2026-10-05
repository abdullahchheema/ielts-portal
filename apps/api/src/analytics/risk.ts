import { type RiskThresholds } from './thresholds';
import { type Trend } from './band';

/**
 * Transparent, rule-based risk. Pure: no database and no clock. `now` is passed in.
 *
 * Every fired rule adds a reason in plain words. The level is the worst severity that fired.
 * Invariant: a level other than GREEN always comes with at least one reason.
 */

export type RiskLevel = 'GREEN' | 'YELLOW' | 'RED';
const RANK: Record<RiskLevel, number> = { GREEN: 0, YELLOW: 1, RED: 2 };
const DAY = 86_400_000;

export interface RiskSignals {
  enrolledAt: Date | null;
  /** Sessions that ended after enrolment, excluding EXCUSED absences from the denominator. */
  attendance: { attended: number; held: number; excused: number };
  /** Latest lesson, test or submission. Login and system events are deliberately excluded. */
  lastAcademicActivityAt: Date | null;
  lastLoginAt: Date | null;
  overdueCount: number;
  lateRecent: number;
  overall: number | null;
  overallPrevious: number | null;
  overallTrend: Trend;
  target: number | null;
  examDate: Date | null;
}

export interface RiskReason { severity: 'YELLOW' | 'RED'; text: string }

export interface RiskResult {
  level: RiskLevel;
  reasons: string[];
  positives: string[];
  /** Every rule that fired, with severity, for audit and tooling. */
  fired: RiskReason[];
  signals: RiskSignals & { attendancePercent: number | null; daysSinceAcademicActivity: number | null; daysToExam: number | null; gapToTarget: number | null };
  thresholdsUsed: RiskThresholds;
}

export function attendancePercentOf(a: RiskSignals['attendance']): number | null {
  const denom = a.held - a.excused;
  return denom > 0 ? Math.round((a.attended / denom) * 100) : null;
}

export function evaluateRisk(s: RiskSignals, t: RiskThresholds, now: Date): RiskResult {
  const fired: RiskReason[] = [];
  const add = (severity: 'YELLOW' | 'RED', text: string) => fired.push({ severity, text });
  const pct = attendancePercentOf(s.attendance);
  const daysSinceAcademic = s.lastAcademicActivityAt ? Math.floor((now.getTime() - s.lastAcademicActivityAt.getTime()) / DAY) : null;
  const daysEnrolled = s.enrolledAt ? Math.floor((now.getTime() - s.enrolledAt.getTime()) / DAY) : null;
  const daysToExam = s.examDate ? Math.ceil((s.examDate.getTime() - now.getTime()) / DAY) : null;
  const gap = s.target !== null && s.overall !== null ? Math.round((s.target - s.overall) * 2) / 2 : null;

  // 1. Attendance
  if (pct !== null) {
    const shown = `Attendance is ${pct}% (${s.attendance.attended} of ${s.attendance.held - s.attendance.excused} sessions)`;
    if (pct < t.attendanceRedPercent) add('RED', `${shown}, below the ${t.attendanceRedPercent}% threshold.`);
    else if (pct < t.attendanceYellowPercent) add('YELLOW', `${shown}, below the ${t.attendanceYellowPercent}% threshold.`);
  }

  // 2 and 7. Academic inactivity. A student who has never been active is judged by rule 7 instead.
  if (daysSinceAcademic !== null) {
    if (daysSinceAcademic >= t.inactivityRedDays) add('RED', `No lessons, tests or submissions for ${daysSinceAcademic} days.`);
    else if (daysSinceAcademic >= t.inactivityYellowDays) add('YELLOW', `No lessons, tests or submissions for ${daysSinceAcademic} days.`);
  } else if (daysEnrolled !== null) {
    if (daysEnrolled >= t.noActivityRedDays) add('RED', `Enrolled ${daysEnrolled} days ago with no recorded activity.`);
    else if (daysEnrolled >= t.noActivityYellowDays) add('YELLOW', `Enrolled ${daysEnrolled} days ago with no recorded activity.`);
  }

  // 3. Estimated band trend
  if (s.overallTrend === 'DECLINING') {
    const was = s.overallPrevious !== null ? ` from ${s.overallPrevious} to ${s.overall}` : '';
    const lowAttendance = pct !== null && pct < t.attendanceYellowPercent;
    add(lowAttendance ? 'RED' : 'YELLOW', `Estimated overall band has fallen${was}.`);
  }

  // 4. Overdue assignments
  if (s.overdueCount >= t.overdueRedCount) add('RED', `${s.overdueCount} assignments are past their due date and not submitted.`);
  else if (s.overdueCount >= t.overdueYellowCount) add('YELLOW', `${s.overdueCount} assignment${s.overdueCount === 1 ? ' is' : 's are'} past the due date and not submitted.`);

  // 5. Late submissions
  if (s.lateRecent >= t.lateYellowCount) add('YELLOW', `${s.lateRecent} recent submissions were late (last ${t.lateWindowDays} days).`);

  // 6. Exam proximity against the gap to target
  if (gap !== null && daysToExam !== null && daysToExam >= 0) {
    const gapText = `estimated band is ${gap} below the ${s.target} target`;
    if (gap > t.gapRedBands && daysToExam <= t.examImminentDays) add('RED', `Exam in ${daysToExam} days; ${gapText}.`);
    else if (gap > t.gapYellowBands && daysToExam <= t.examSoonDays) add('YELLOW', `Exam in ${daysToExam} days; ${gapText}.`);
  }

  const worst = fired.reduce<RiskLevel>((acc, r) => (RANK[r.severity] > RANK[acc] ? r.severity : acc), 'GREEN');
  const reasons = fired.map((r) => r.text);
  const positives: string[] = [];
  if (worst === 'GREEN') {
    if (pct !== null) positives.push(`Attendance ${pct}%`);
    if (s.overallTrend === 'IMPROVING') positives.push('Estimated band is improving');
    if (daysSinceAcademic !== null && daysSinceAcademic < t.inactivityYellowDays) positives.push(`Active in the last ${Math.max(daysSinceAcademic, 0)} days`);
  }

  return {
    level: worst,
    reasons: worst === 'GREEN' ? [] : reasons,
    positives,
    fired,
    signals: { ...s, attendancePercent: pct, daysSinceAcademicActivity: daysSinceAcademic, daysToExam, gapToTarget: gap },
    thresholdsUsed: t,
  };
}
