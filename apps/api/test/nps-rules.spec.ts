import { describe, expect, it } from 'vitest';
import { categorize, monthlyTrend, MIN_RESPONSES, npsSummary, responseRecord, themes } from '../src/feedback/nps';

/** Feedback and NPS rules. Pure. Anonymous responses are never linked to a student or a request. */

describe('NPS categories', () => {
  it('9 and 10 are promoters, 7 and 8 passive, 0 to 6 detractors', () => {
    expect(categorize(10)).toBe('PROMOTER');
    expect(categorize(9)).toBe('PROMOTER');
    expect(categorize(8)).toBe('PASSIVE');
    expect(categorize(7)).toBe('PASSIVE');
    expect(categorize(6)).toBe('DETRACTOR');
    expect(categorize(0)).toBe('DETRACTOR');
  });
});

describe('NPS score', () => {
  const five = [10, 10, 9, 8, 3];
  it('is the percentage of promoters minus detractors', () => {
    const s = npsSummary(five, 10);
    expect(s).toMatchObject({ responses: 5, promoters: 3, passives: 1, detractors: 1, nps: 40, responseRate: 50, suppressed: false });
  });
  it('is hidden below the minimum sample, so a few people cannot be identified from it', () => {
    const s = npsSummary([10, 10, 3], 3);
    expect(s.suppressed).toBe(true);
    expect(s.nps).toBeNull();
    expect(s.promoters).toBe(0);
    expect(s.detractors).toBe(0);
    expect(s.responses).toBe(3);
  });
  it('reports no response rate when nothing was sent', () => {
    expect(npsSummary(five, 0).responseRate).toBeNull();
  });
  it('a sample of exactly the minimum is shown', () => {
    expect(npsSummary(Array(MIN_RESPONSES).fill(10), 5).nps).toBe(100);
  });
});

describe('monthly trend', () => {
  it('groups by UTC month, oldest first, and hides months under the minimum', () => {
    const rows = [
      ...[10, 10, 10, 10, 10].map((score) => ({ score, at: new Date('2026-08-10T12:00:00Z') })),
      ...[3].map((score) => ({ score, at: new Date('2026-09-01T00:30:00Z') })),
    ];
    const t = monthlyTrend(rows);
    expect(t.map((m) => m.month)).toEqual(['2026-08', '2026-09']);
    expect(t[0].nps).toBe(100);
    expect(t[1].nps).toBeNull();
  });
});

describe('themes', () => {
  it('lists words that recur across comments, most frequent first, ignoring filler', () => {
    const comments = [
      'The speaking classes were helpful and the teacher was patient',
      'Speaking practice helped me a lot, but the schedule changes were confusing',
      'More speaking practice please, the schedule keeps changing',
      'Helpful teacher, clear speaking feedback',
      'The recordings are useful when I miss a class',
    ];
    const t = themes(comments);
    expect(t[0]).toEqual({ word: 'speaking', count: 4 });
    expect(t.map((x) => x.word)).toContain('schedule');
    expect(t.map((x) => x.word)).not.toContain('with');
  });
  it('shows no themes until there are enough comments to avoid quoting individuals', () => {
    expect(themes(['speaking practice', 'speaking again'])).toEqual([]);
  });
});

describe('response record', () => {
  const base = { surveyId: 's1', batchId: 'b1', trigger: 'MOCK_EXAM', studentId: 'st1', requestId: 'rq1', score: 9, comments: { overall: '  Useful  ' } };

  it('a named response keeps the student and the request link', () => {
    expect(responseRecord({ ...base, anonymous: false })).toMatchObject({ studentId: 'st1', requestId: 'rq1', anonymous: false, commentOverall: 'Useful' });
  });

  it('an anonymous response keeps the content but no student or request link', () => {
    const r = responseRecord({ ...base, anonymous: true });
    expect(r.studentId).toBeNull();
    expect(r.requestId).toBeNull();
    expect(r.anonymous).toBe(true);
    expect(r.score).toBe(9);
    expect(r.commentOverall).toBe('Useful');
    expect(r.batchId).toBe('b1');
    expect(JSON.stringify(r)).not.toContain('st1');
    expect(JSON.stringify(r)).not.toContain('rq1');
  });

  it('empty comments are stored as null', () => {
    expect(responseRecord({ ...base, anonymous: false, comments: { overall: '   ' } }).commentOverall).toBeNull();
  });
});
