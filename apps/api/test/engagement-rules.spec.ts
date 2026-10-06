import { describe, expect, it } from 'vitest';
import { alertLevel, attendancePercent, attendanceStreak, attendanceWarnings, DEFAULT_ATTENDANCE_RULES, engagementStatus, isoWeek, leaderboardEntries, LeaderboardInput, MarkedSession, periodKey } from '../src/engagement/engagement-rules';
import { dueReminders, localText, reminderKey, REMINDER_OFFSETS_MINUTES, SessionForReminder } from '../src/engagement/reminders';

/** Attendance, engagement, leaderboard and reminder rules. Pure. */

const NOW = new Date('2026-10-06T12:00:00Z');
const at = (daysAgo: number, status: MarkedSession['status']): MarkedSession => ({ startsAt: new Date(NOW.getTime() - daysAgo * 86_400_000), status });

describe('attendance rules', () => {
  it('percentage counts late as present and ignores excused absences', () => {
    expect(attendancePercent([at(1, 'PRESENT'), at(2, 'LATE'), at(3, 'ABSENT'), at(4, 'EXCUSED')])).toBe(67);
    expect(attendancePercent([at(1, 'EXCUSED')])).toBeNull();
  });
  it('streak counts attended sessions back from the latest, skipping excused ones', () => {
    expect(attendanceStreak([at(1, 'PRESENT'), at(2, 'EXCUSED'), at(3, 'LATE'), at(4, 'ABSENT')])).toBe(2);
  });
  it('raises a low-attendance warning once for the term', () => {
    const w = attendanceWarnings([at(1, 'ABSENT'), at(2, 'ABSENT'), at(3, 'PRESENT'), at(4, 'PRESENT')], DEFAULT_ATTENDANCE_RULES, NOW);
    expect(w.find((x) => x.rule === 'LOW_ATTENDANCE')?.windowKey).toBe('term');
  });
  it('two misses in a row raise a consecutive-misses warning keyed to the run', () => {
    const w = attendanceWarnings([at(3, 'ABSENT'), at(2, 'ABSENT'), at(1, 'PRESENT')], DEFAULT_ATTENDANCE_RULES, NOW);
    expect(w.some((x) => x.rule === 'CONSECUTIVE_MISSES')).toBe(true);
  });
  it('three misses in seven days raise a weekly warning', () => {
    const w = attendanceWarnings([at(1, 'ABSENT'), at(2, 'ABSENT'), at(3, 'ABSENT')], DEFAULT_ATTENDANCE_RULES, NOW);
    expect(w.find((x) => x.rule === 'MISSES_7_DAYS')?.windowKey).toBe(isoWeek(NOW));
  });
  it('the ISO week key is stable within a week and changes across weeks', () => {
    expect(isoWeek(new Date('2026-10-05T00:00:00Z'))).toBe(isoWeek(new Date('2026-10-06T00:00:00Z')));
    expect(isoWeek(new Date('2026-10-12T00:00:00Z'))).not.toBe(isoWeek(new Date('2026-10-06T00:00:00Z')));
  });
});

describe('engagement status', () => {
  const base = { daysSinceActivity: 1, daysSinceLogin: 1, activityLabel: 'Reading practice', attendancePercent: 90, overdueAssignments: 0, previous: null };
  it('active while recently active', () => {
    expect(engagementStatus(base).status).toBe('ACTIVE');
  });
  it('at risk after seven days, inactive after fourteen, with a reason naming the days', () => {
    const risk = engagementStatus({ ...base, daysSinceActivity: 9 });
    expect(risk.status).toBe('AT_RISK');
    expect(risk.reasons[0]).toMatch(/inactive for 9 days/);
    expect(engagementStatus({ ...base, daysSinceActivity: 15 }).status).toBe('INACTIVE');
  });
  it('a student who returns from at-risk or inactive is marked reactivated', () => {
    expect(engagementStatus({ ...base, previous: 'INACTIVE' }).status).toBe('REACTIVATED');
    expect(engagementStatus({ ...base, previous: 'AT_RISK' }).status).toBe('REACTIVATED');
  });
  it('overdue work and low attendance are named as reasons', () => {
    const r = engagementStatus({ ...base, daysSinceActivity: 9, attendancePercent: 60, overdueAssignments: 2 });
    expect(r.reasons.join(' ')).toMatch(/Attendance: 60%/);
    expect(r.reasons.join(' ')).toMatch(/2 assignments past due/);
  });
  it('alert colour follows status and attendance', () => {
    expect(alertLevel('INACTIVE', 90)).toBe('RED');
    expect(alertLevel('AT_RISK', 60)).toBe('RED');
    expect(alertLevel('AT_RISK', 90)).toBe('YELLOW');
    expect(alertLevel('ACTIVE', 90)).toBe('GREEN');
  });
});

describe('leaderboards', () => {
  const row = (over: Partial<LeaderboardInput>): LeaderboardInput => ({
    studentId: 'x', firstName: 'Ayesha', lastName: 'Khan', optedOut: false, practiceAnswers: 0, mocksCompleted: 0, attendance: null, assignmentsSubmitted: 0, improvement: null, ...over,
  });
  it('ranks by academic activity and shows only first name and an initial', () => {
    const e = leaderboardEntries([row({ studentId: 'a', practiceAnswers: 10 }), row({ studentId: 'b', mocksCompleted: 3, firstName: 'Bilal', lastName: 'Ahmed' })]);
    expect(e[0].studentId).toBe('b');
    expect(e[0].name).toBe('Bilal A.');
    expect(e[0].rank).toBe(1);
  });
  it('students who opted out are not ranked at all', () => {
    const e = leaderboardEntries([row({ studentId: 'a', practiceAnswers: 500, optedOut: true }), row({ studentId: 'b', practiceAnswers: 1 })]);
    expect(e.map((x) => x.studentId)).toEqual(['b']);
  });
  it('practice points are capped so volume alone cannot dominate', () => {
    const big = leaderboardEntries([row({ studentId: 'a', practiceAnswers: 5000 })])[0].points;
    const capped = leaderboardEntries([row({ studentId: 'a', practiceAnswers: 200 })])[0].points;
    expect(big).toBe(capped);
  });
  it('period keys are weekly ISO weeks or calendar months', () => {
    expect(periodKey('MONTHLY', NOW)).toBe('2026-10');
    expect(periodKey('WEEKLY', NOW)).toBe(isoWeek(NOW));
  });
});

describe('class reminders', () => {
  const start = new Date(NOW.getTime() + 50 * 60_000);
  const session: SessionForReminder = { id: 's1', topic: 'Writing clinic', title: null, startsAt: start, status: 'SCHEDULED', timezone: 'Asia/Karachi' };
  it('a reminder is due once the session is inside its window', () => {
    const r = dueReminders([session], REMINDER_OFFSETS_MINUTES, NOW);
    expect(r.map((x) => x.offsetMinutes)).toEqual([1440, 60]);
  });
  it('a cancelled session never produces a reminder', () => {
    expect(dueReminders([{ ...session, status: 'CANCELLED' }], REMINDER_OFFSETS_MINUTES, NOW)).toEqual([]);
  });
  it('a session that has already started produces no reminder', () => {
    expect(dueReminders([session], REMINDER_OFFSETS_MINUTES, new Date(start.getTime() + 60_000))).toEqual([]);
  });
  it('the 24-hour key keeps its legacy name so nothing is sent twice', () => {
    expect(reminderKey(1440, 'abc')).toBe('class24:abc');
    expect(reminderKey(15, 'abc')).toBe('class15:abc');
  });
  it('times are shown in the batch timezone', () => {
    const text = localText(new Date('2026-10-06T10:00:00Z'), 'Asia/Karachi');
    expect(text).toMatch(/15:00/);
  });
});
