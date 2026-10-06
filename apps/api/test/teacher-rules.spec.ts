import { describe, expect, it } from 'vitest';
import { batchHealth, BatchMetrics, isSuppressed, MIN_GROUP } from '../src/teacher-workspace/batch-health';

/** Batch health rules. Pure: every status must come with the reasons behind it. */

const healthy: BatchMetrics = {
  activeStudents: 10, attendancePercent: 92, completionPercent: 70, mockCompletionPercent: 80, atRiskStudents: 0,
  pendingAssignments: 0, averageTargetGap: 0.2, averageImprovement: 0.5,
};

describe('batch health', () => {
  it('a healthy batch is green with no reasons', () => {
    expect(batchHealth(healthy)).toEqual({ status: 'GREEN', reasons: [] });
  });

  it('falling attendance below the yellow line makes a batch yellow, and says why', () => {
    const r = batchHealth({ ...healthy, attendancePercent: 74 });
    expect(r.status).toBe('YELLOW');
    expect(r.reasons.join(' ')).toMatch(/Attendance fell below 80%/);
  });

  it('attendance below the red line makes a batch red', () => {
    expect(batchHealth({ ...healthy, attendancePercent: 60 }).status).toBe('RED');
  });

  it('students who have not done a recent mock are counted in the reason', () => {
    const r = batchHealth({ ...healthy, mockCompletionPercent: 50 });
    expect(r.status).toBe('YELLOW');
    expect(r.reasons.join(' ')).toMatch(/5 students have not completed a recent mock/);
  });

  it('a large share of students at risk is red, and the reason gives the count', () => {
    const r = batchHealth({ ...healthy, atRiskStudents: 4 });
    expect(r.status).toBe('RED');
    expect(r.reasons.join(' ')).toMatch(/4 of 10 students are at risk/);
  });

  it('a wide gap to target is reported in bands', () => {
    const r = batchHealth({ ...healthy, averageTargetGap: 0.6 });
    expect(r.reasons.join(' ')).toMatch(/0.6 bands/);
  });

  it('red reasons come first, then the yellow ones', () => {
    const r = batchHealth({ ...healthy, attendancePercent: 60, mockCompletionPercent: 40 });
    expect(r.status).toBe('RED');
    expect(r.reasons[0]).toMatch(/Attendance fell to 60%/);
  });

  it('a batch with no data yet is green rather than guessed at', () => {
    expect(batchHealth({ ...healthy, attendancePercent: null, mockCompletionPercent: null, averageTargetGap: null }).status).toBe('GREEN');
  });
});

describe('small groups are never reported', () => {
  it('a group below the minimum size is suppressed', () => {
    expect(isSuppressed(MIN_GROUP - 1)).toBe(true);
    expect(isSuppressed(MIN_GROUP)).toBe(false);
  });
});
