/**
 * Batch health as pure rules. Every status comes with the reasons that produced it, so a teacher or administrator
 * can see why a batch is yellow or red and act on it. Nothing here reads the database or the clock.
 */

export interface BatchMetrics {
  activeStudents: number;
  attendancePercent: number | null;
  completionPercent: number | null;
  /** Share of active students with a mock test in the last 30 days, 0–100. */
  mockCompletionPercent: number | null;
  atRiskStudents: number;
  pendingAssignments: number;
  /** Average of (target − current) across students who have both, in bands. Positive means behind. */
  averageTargetGap: number | null;
  /** Average change in estimated band over the last 60 days, in bands. */
  averageImprovement: number | null;
}

export interface HealthThresholds {
  attendanceYellow: number;
  attendanceRed: number;
  mockYellow: number;
  atRiskRedShare: number;
  atRiskYellowShare: number;
  gapYellow: number;
  gapRed: number;
}

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  attendanceYellow: 80, attendanceRed: 65, mockYellow: 60, atRiskYellowShare: 0.15, atRiskRedShare: 0.3, gapYellow: 0.5, gapRed: 1,
};

export type Health = 'GREEN' | 'YELLOW' | 'RED';

export function batchHealth(m: BatchMetrics, t: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS): { status: Health; reasons: string[] } {
  const yellow: string[] = [];
  const red: string[] = [];
  const share = m.activeStudents > 0 ? m.atRiskStudents / m.activeStudents : 0;

  if (m.attendancePercent !== null) {
    if (m.attendancePercent < t.attendanceRed) red.push(`Attendance fell to ${m.attendancePercent}%`);
    else if (m.attendancePercent < t.attendanceYellow) yellow.push(`Attendance fell below ${t.attendanceYellow}%`);
  }
  if (share >= t.atRiskRedShare && m.atRiskStudents > 0) red.push(`${m.atRiskStudents} of ${m.activeStudents} students are at risk`);
  else if (share >= t.atRiskYellowShare && m.atRiskStudents > 0) yellow.push(`${m.atRiskStudents} students are at risk`);
  if (m.mockCompletionPercent !== null && m.mockCompletionPercent < t.mockYellow) {
    const missing = Math.max(0, m.activeStudents - Math.round((m.mockCompletionPercent / 100) * m.activeStudents));
    yellow.push(`${missing} student${missing === 1 ? ' has' : 's have'} not completed a recent mock`);
  }
  if (m.averageTargetGap !== null) {
    if (m.averageTargetGap >= t.gapRed) red.push(`The average gap to target is ${m.averageTargetGap.toFixed(1)} bands`);
    else if (m.averageTargetGap >= t.gapYellow) yellow.push(`The average gap to target is ${m.averageTargetGap.toFixed(1)} bands`);
  }
  if (m.pendingAssignments > 0 && m.activeStudents > 0 && m.pendingAssignments / m.activeStudents >= 2) {
    yellow.push(`${m.pendingAssignments} assignments are waiting to be submitted`);
  }

  if (red.length) return { status: 'RED', reasons: [...red, ...yellow] };
  if (yellow.length) return { status: 'YELLOW', reasons: yellow };
  return { status: 'GREEN', reasons: [] };
}

/** Cohort comparisons hide any group smaller than this, so a single student is never identifiable from a chart. */
export const MIN_GROUP = 3;

/** True when a group is too small to report. Its metrics must then be withheld, not just hidden in the UI. */
export const isSuppressed = (size: number) => size < MIN_GROUP;
