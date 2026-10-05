import { describe, expect, it } from 'vitest';
import { SKILLS, gapTo, overallEstimate, roundHalfBand, skillEstimate, type Skill, type SkillEstimateCore } from '../src/analytics/band';

describe('roundHalfBand', () => {
  it('rounds to the nearest half band, with .25 and .75 going up', () => {
    expect(roundHalfBand(6.0)).toBe(6.0);
    expect(roundHalfBand(6.25)).toBe(6.5);   // .25 rounds up
    expect(roundHalfBand(6.75)).toBe(7.0);   // .75 rounds up
    expect(roundHalfBand(6.2)).toBe(6.0);
    expect(roundHalfBand(6.7)).toBe(6.5);
  });
});

describe('skillEstimate', () => {
  it('has no estimate and no trend with no data', () => {
    const r = skillEstimate([]);
    expect(r).toMatchObject({ estimated: null, previous: null, delta: null, trend: 'INSUFFICIENT_DATA', pointCount: 0 });
  });

  it('gives an estimate but no trend from a single point', () => {
    const r = skillEstimate([6.5]);
    expect(r).toMatchObject({ estimated: 6.5, previous: null, trend: 'INSUFFICIENT_DATA', pointCount: 1 });
  });

  it('weights the newest point most (3, 2, 1 over the last three)', () => {
    // newest first: 7, 6, 5 => (7*3 + 6*2 + 5*1) / 6 = 6.333... => 6.5 after rounding
    expect(skillEstimate([7, 6, 5]).estimated).toBe(6.5);
  });

  it('only uses the most recent three points', () => {
    // a fourth, very old point must not move the estimate
    expect(skillEstimate([7, 6, 5, 1]).estimated).toBe(skillEstimate([7, 6, 5]).estimated);
  });

  it('reports previous and a rising trend when the recent scores climb by half a band or more', () => {
    const r = skillEstimate([7, 6, 5]);
    expect(r.previous).toBe(roundHalfBand((6 * 3 + 5 * 2 + 5 * 1) / 6)); // estimate without the newest point
    expect(r.trend).toBe('IMPROVING');
    expect(r.delta).toBeGreaterThanOrEqual(0.5);
  });

  it('reports a declining trend when the recent scores fall', () => {
    expect(skillEstimate([5, 6, 7]).trend).toBe('DECLINING');
  });

  it('calls a change under half a band STABLE', () => {
    expect(skillEstimate([6, 6, 6]).trend).toBe('STABLE');
  });
});

function core(estimated: number | null, previous: number | null = null): SkillEstimateCore {
  return { estimated, previous, delta: null, trend: 'INSUFFICIENT_DATA', pointCount: estimated === null ? 0 : 2 };
}

describe('overallEstimate', () => {
  it('is never invented: it stays null and names the missing skill when one skill has no data', () => {
    const skills = { LISTENING: core(6), READING: core(6), WRITING: core(6), SPEAKING: core(null) } as Record<Skill, SkillEstimateCore>;
    const r = overallEstimate(skills);
    expect(r.overall).toBeNull();
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA');
    expect(r.missingSkills).toEqual(['SPEAKING']);
  });

  it('averages the four skills and rounds to the half band when all four are present', () => {
    const skills = { LISTENING: core(7), READING: core(6), WRITING: core(6), SPEAKING: core(6) } as Record<Skill, SkillEstimateCore>;
    // (7 + 6 + 6 + 6) / 4 = 6.25 => 6.5
    expect(overallEstimate(skills)).toMatchObject({ overall: 6.5, overallStatus: 'OK', missingSkills: [] });
  });

  it('does not invent a trend when a previous value is missing for any skill', () => {
    const skills = { LISTENING: core(7, 6), READING: core(6), WRITING: core(6), SPEAKING: core(6) } as Record<Skill, SkillEstimateCore>;
    expect(overallEstimate(skills).overallTrend).toBe('INSUFFICIENT_DATA');
  });

  it('covers exactly the four IELTS skills', () => {
    expect([...SKILLS]).toEqual(['LISTENING', 'READING', 'WRITING', 'SPEAKING']);
  });
});

describe('gapTo', () => {
  it('is target minus estimate, and null when either side is unknown', () => {
    expect(gapTo(7, 6)).toBe(1);
    expect(gapTo(7, null)).toBeNull();
    expect(gapTo(null, 6)).toBeNull();
  });
});
