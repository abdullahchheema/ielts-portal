import { describe, expect, it } from 'vitest';
import { pointBiserial } from '../src/analytics/content-analytics.service';

describe('pointBiserial (question discrimination)', () => {
  it('is null with fewer than ten answers, where the figure would not mean anything', () => {
    expect(pointBiserial([{ correct: true, percent: 80 }, { correct: false, percent: 40 }])).toBeNull();
  });

  it('is null when everyone got the question right, because nothing separates the students', () => {
    const all = Array.from({ length: 12 }, (_, i) => ({ correct: true, percent: 50 + i }));
    expect(pointBiserial(all)).toBeNull();
  });

  it('is positive when stronger students get the question right', () => {
    const answers = [
      ...Array.from({ length: 6 }, () => ({ correct: true, percent: 85 })),
      ...Array.from({ length: 6 }, () => ({ correct: false, percent: 45 })),
    ];
    expect(pointBiserial(answers)).toBeGreaterThan(0.8);
  });

  it('is negative when weaker students get it right and stronger ones miss it', () => {
    const answers = [
      ...Array.from({ length: 6 }, () => ({ correct: true, percent: 40 })),
      ...Array.from({ length: 6 }, () => ({ correct: false, percent: 90 })),
    ];
    expect(pointBiserial(answers)).toBeLessThan(-0.8);
  });
});
