import { describe, expect, it } from 'vitest';
import { attendancePercentOf, evaluateRisk, type RiskSignals } from '../src/analytics/risk';
import { DEFAULT_RISK_THRESHOLDS as T, riskThresholdsSchema } from '../src/analytics/thresholds';

const NOW = new Date('2026-10-05T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const daysAhead = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

/** A healthy student. Each test overrides only the signal it is about. */
function base(over: Partial<RiskSignals> = {}): RiskSignals {
  return {
    enrolledAt: daysAgo(60),
    attendance: { attended: 19, held: 20, excused: 0 },
    lastAcademicActivityAt: daysAgo(1),
    lastLoginAt: daysAgo(0),
    overdueCount: 0,
    lateRecent: 0,
    overall: 6.5,
    overallPrevious: 6.5,
    overallTrend: 'STABLE',
    target: 6.5,
    examDate: null,
    ...over,
  };
}

describe('attendancePercentOf', () => {
  it('excludes EXCUSED absences from the denominator', () => {
    expect(attendancePercentOf({ attended: 8, held: 10, excused: 2 })).toBe(100);
    expect(attendancePercentOf({ attended: 6, held: 10, excused: 0 })).toBe(60);
  });
  it('is null when no sessions count yet, so it is never a reason', () => {
    expect(attendancePercentOf({ attended: 0, held: 0, excused: 0 })).toBeNull();
    expect(attendancePercentOf({ attended: 0, held: 2, excused: 2 })).toBeNull();
  });
});

describe('evaluateRisk: a healthy student', () => {
  it('is GREEN with no reasons and some positives', () => {
    const r = evaluateRisk(base(), T, NOW);
    expect(r.level).toBe('GREEN');
    expect(r.reasons).toEqual([]);
    expect(r.positives.length).toBeGreaterThan(0);
  });
});

describe('attendance rule', () => {
  it('is YELLOW below the yellow threshold and RED below the red one', () => {
    const yellow = evaluateRisk(base({ attendance: { attended: 7, held: 10, excused: 0 } }), T, NOW);
    expect(yellow.level).toBe('YELLOW');
    expect(yellow.reasons.join(' ')).toContain('70%');
    const red = evaluateRisk(base({ attendance: { attended: 5, held: 10, excused: 0 } }), T, NOW);
    expect(red.level).toBe('RED');
  });

  it('sits exactly on the threshold without firing', () => {
    expect(evaluateRisk(base({ attendance: { attended: 8, held: 10, excused: 0 } }), T, NOW).level).toBe('GREEN');
  });
});

describe('inactivity rule', () => {
  it('uses academic activity, so a recent login alone does not count as activity', () => {
    const r = evaluateRisk(base({ lastLoginAt: daysAgo(0), lastAcademicActivityAt: daysAgo(10) }), T, NOW);
    expect(r.level).toBe('YELLOW');
    expect(r.reasons.join(' ')).toContain('10 days');
  });

  it('is RED after the red threshold', () => {
    expect(evaluateRisk(base({ lastAcademicActivityAt: daysAgo(15) }), T, NOW).level).toBe('RED');
  });
});

describe('never-started rule (7) replaces inactivity when there is no activity at all', () => {
  it('fires on enrolment age, not on a missing timestamp', () => {
    const r = evaluateRisk(base({ lastAcademicActivityAt: null, enrolledAt: daysAgo(31) }), T, NOW);
    expect(r.level).toBe('RED');
    expect(r.reasons.join(' ')).toContain('no recorded activity');
    expect(r.fired.filter((f) => f.text.includes('no recorded activity'))).toHaveLength(1);
  });

  it('does not fire for a student enrolled only recently', () => {
    expect(evaluateRisk(base({ lastAcademicActivityAt: null, enrolledAt: daysAgo(3) }), T, NOW).level).toBe('GREEN');
  });
});

describe('band trend rule', () => {
  it('is YELLOW when the estimate is declining, and names the change', () => {
    const r = evaluateRisk(base({ overallTrend: 'DECLINING', overallPrevious: 6.5, overall: 6.0 }), T, NOW);
    expect(r.level).toBe('YELLOW');
    expect(r.reasons.join(' ')).toContain('from 6.5 to 6');
  });

  it('escalates to RED when it declines while attendance is already below the yellow line', () => {
    const r = evaluateRisk(base({ overallTrend: 'DECLINING', attendance: { attended: 7, held: 10, excused: 0 } }), T, NOW);
    expect(r.level).toBe('RED');
  });
});

describe('overdue and late rules', () => {
  it('counts overdue work, with a yellow and a red level', () => {
    expect(evaluateRisk(base({ overdueCount: 1 }), T, NOW).level).toBe('YELLOW');
    expect(evaluateRisk(base({ overdueCount: 3 }), T, NOW).level).toBe('RED');
  });

  it('flags a late pattern as YELLOW', () => {
    expect(evaluateRisk(base({ lateRecent: 3 }), T, NOW).level).toBe('YELLOW');
    expect(evaluateRisk(base({ lateRecent: 2 }), T, NOW).level).toBe('GREEN');
  });
});

describe('exam proximity rule', () => {
  it('is YELLOW for a gap over half a band with the exam within 60 days', () => {
    const r = evaluateRisk(base({ overall: 6.0, target: 7.0, examDate: daysAhead(45) }), T, NOW);
    expect(r.level).toBe('YELLOW');
    expect(r.reasons.join(' ')).toContain('1 below the 7 target');
  });

  it('is RED for a gap over a full band with the exam within 30 days', () => {
    expect(evaluateRisk(base({ overall: 5.5, target: 7.0, examDate: daysAhead(20) }), T, NOW).level).toBe('RED');
  });

  it('does nothing without an overall estimate, because a gap cannot be computed', () => {
    expect(evaluateRisk(base({ overall: null, target: 7.0, examDate: daysAhead(10) }), T, NOW).level).toBe('GREEN');
  });
});

describe('level and reasons', () => {
  it('takes the worst severity that fired', () => {
    const r = evaluateRisk(base({ attendance: { attended: 7, held: 10, excused: 0 }, overdueCount: 3 }), T, NOW);
    expect(r.level).toBe('RED');
    expect(r.fired.map((f) => f.severity).sort()).toEqual(['RED', 'YELLOW']);
  });

  it('never returns a non-green level without at least one reason', () => {
    const scenarios: Partial<RiskSignals>[] = [
      { overdueCount: 1 }, { overdueCount: 9 }, { lateRecent: 5 },
      { attendance: { attended: 1, held: 10, excused: 0 } }, { lastAcademicActivityAt: daysAgo(30) },
      { overallTrend: 'DECLINING' }, { overall: 5, target: 8, examDate: daysAhead(10) },
    ];
    for (const s of scenarios) {
      const r = evaluateRisk(base(s), T, NOW);
      if (r.level !== 'GREEN') expect(r.reasons.length).toBeGreaterThan(0);
    }
  });

  it('echoes the signals and thresholds used, so the result can be audited from the response alone', () => {
    const r = evaluateRisk(base(), T, NOW);
    expect(r.thresholdsUsed).toEqual(T);
    expect(r.signals.attendancePercent).toBe(95);
    expect(r.signals.daysSinceAcademicActivity).toBe(1);
  });
});

describe('risk thresholds schema', () => {
  it('has defaults that match the plan', () => {
    expect(T).toMatchObject({ attendanceYellowPercent: 80, attendanceRedPercent: 60, inactivityYellowDays: 7, inactivityRedDays: 14 });
  });

  it('rejects a red threshold that is looser than its yellow one', () => {
    expect(riskThresholdsSchema.safeParse({ attendanceYellowPercent: 70, attendanceRedPercent: 80 }).success).toBe(false);
    expect(riskThresholdsSchema.safeParse({ inactivityYellowDays: 14, inactivityRedDays: 7 }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(riskThresholdsSchema.safeParse({ notAThreshold: 1 }).success).toBe(false);
  });
});
