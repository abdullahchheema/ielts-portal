import { describe, expect, it } from 'vitest';
import {
  GradableQuestion, bandFromRaw, gradeAttempt, isCorrect, normalizeText, roundIeltsBand, sanitizeAnswer, validateQuestionDefinition,
} from '../src/assessments/grading';

const mcq = (correct: string[], all = ['a', 'b', 'c'], type: 'MCQ_SINGLE' | 'MCQ_MULTI' = 'MCQ_SINGLE'): GradableQuestion => ({
  type, marks: 1, answerKey: null, options: all.map((id) => ({ id, isCorrect: correct.includes(id) })),
});
const completion = (accepted: string[]): GradableQuestion => ({ type: 'COMPLETION', marks: 1, options: [], answerKey: { accepted } });
const tfng = (value: string): GradableQuestion => ({ type: 'TFNG', marks: 1, options: [], answerKey: { value } });
const ordering = (correctOrder: string[]): GradableQuestion => ({
  type: 'ORDERING', marks: 1, answerKey: { correctOrder }, options: correctOrder.map((id) => ({ id, isCorrect: false })),
});
const numerical = (numericValue: number, tolerance = 0): GradableQuestion => ({ type: 'NUMERICAL', marks: 1, options: [], answerKey: { numericValue, tolerance } });
const multiBlank = (blanks: { key: string; accepted: string[] }[]): GradableQuestion => ({ type: 'MULTI_BLANK', marks: 1, options: [], answerKey: { blanks } });
const matchingMappings = (mappings: { left: string; right: string }[]): GradableQuestion => ({ type: 'MATCHING', marks: 1, options: [], answerKey: { mappings } });

describe('normalizeText', () => {
  it('ignores case, spacing and edge punctuation', () => {
    expect(normalizeText('  The   Library. ')).toBe('the library');
    expect(normalizeText('"Twelve",')).toBe('twelve');
  });
});

describe('isCorrect', () => {
  it('grades single choice', () => {
    expect(isCorrect(mcq(['b']), { optionIds: ['b'] })).toBe(true);
    expect(isCorrect(mcq(['b']), { optionIds: ['a'] })).toBe(false);
    expect(isCorrect(mcq(['b']), { optionIds: [] })).toBe(false);
    expect(isCorrect(mcq(['b']), undefined)).toBe(false);
  });
  it('multi-select is all-or-nothing (no partial credit, no extras)', () => {
    const q = mcq(['a', 'c'], ['a', 'b', 'c'], 'MCQ_MULTI');
    expect(isCorrect(q, { optionIds: ['c', 'a'] })).toBe(true);
    expect(isCorrect(q, { optionIds: ['a'] })).toBe(false);
    expect(isCorrect(q, { optionIds: ['a', 'b', 'c'] })).toBe(false);
  });
  it('True/False/Not Given', () => {
    expect(isCorrect(tfng('NOT_GIVEN'), { value: 'NOT_GIVEN' })).toBe(true);
    expect(isCorrect(tfng('TRUE'), { value: 'FALSE' })).toBe(false);
  });
  it('completion accepts alternatives, ignoring case/spacing, but not blanks', () => {
    const q = completion(['library', 'the library']);
    expect(isCorrect(q, { text: ' The  Library. ' })).toBe(true);
    expect(isCorrect(q, { text: 'LIBRARY' })).toBe(true);
    expect(isCorrect(q, { text: 'libary' })).toBe(false);
    expect(isCorrect(q, { text: '   ' })).toBe(false);
  });
  it('ordering requires the exact sequence', () => {
    const q = ordering(['a', 'b', 'c']);
    expect(isCorrect(q, { orderedIds: ['a', 'b', 'c'] })).toBe(true);
    expect(isCorrect(q, { orderedIds: ['a', 'c', 'b'] })).toBe(false);
    expect(isCorrect(q, { orderedIds: ['a', 'b'] })).toBe(false);
    expect(isCorrect(q, undefined)).toBe(false);
  });
  it('numerical matches within tolerance', () => {
    expect(isCorrect(numerical(42), { value: 42 })).toBe(true);
    expect(isCorrect(numerical(42), { value: 43 })).toBe(false);
    expect(isCorrect(numerical(42, 1), { value: 43 })).toBe(true);
    expect(isCorrect(numerical(42, 1), { value: 44 })).toBe(false);
  });
  it('multi-blank requires every blank correct', () => {
    const q = multiBlank([{ key: 'b1', accepted: ['cat'] }, { key: 'b2', accepted: ['dog', 'puppy'] }]);
    expect(isCorrect(q, { blanks: { b1: 'Cat', b2: 'puppy' } })).toBe(true);
    expect(isCorrect(q, { blanks: { b1: 'cat', b2: 'bird' } })).toBe(false);
    expect(isCorrect(q, { blanks: { b1: 'cat' } })).toBe(false);
  });
  it('matching with explicit mappings requires every pair correct', () => {
    const q = matchingMappings([{ left: '1', right: 'x' }, { left: '2', right: 'y' }]);
    expect(isCorrect(q, { mappings: { '1': 'x', '2': 'y' } })).toBe(true);
    expect(isCorrect(q, { mappings: { '1': 'x', '2': 'z' } })).toBe(false);
  });
  it('matching without mappings falls back to single-correct-option behavior', () => {
    const q = mcq(['b'], ['a', 'b', 'c'], 'MCQ_SINGLE');
    q.type = 'MATCHING';
    expect(isCorrect(q, { optionIds: ['b'] })).toBe(true);
    expect(isCorrect(q, { optionIds: ['a'] })).toBe(false);
  });
});

describe('partial credit', () => {
  it('MCQ_MULTI awards proportional credit net of wrong picks, floored at zero', () => {
    const q = { ...mcq(['a', 'c'], ['a', 'b', 'c'], 'MCQ_MULTI'), partialCredit: true, marks: 2 };
    expect(gradeAttempt([q], [{ optionIds: ['a'] }]).perQuestion[0]).toMatchObject({ correct: false, earned: 1, partial: true }); // 1 hit / 2 correct
    expect(gradeAttempt([q], [{ optionIds: ['a', 'b'] }]).perQuestion[0]).toMatchObject({ correct: false, earned: 0 }); // 1 hit - 1 miss = 0
    expect(gradeAttempt([q], [{ optionIds: ['a', 'c'] }]).perQuestion[0]).toMatchObject({ correct: true, earned: 2 });
  });
  it('ORDERING awards credit for correctly-ordered pairs', () => {
    const q = { ...ordering(['a', 'b', 'c', 'd']), partialCredit: true, marks: 3 };
    // swap b and c: 5 of 6 pairs still correctly ordered
    const r = gradeAttempt([q], [{ orderedIds: ['a', 'c', 'b', 'd'] }]).perQuestion[0];
    expect(r.correct).toBe(false);
    expect(r.earned).toBeCloseTo(2.5, 2); // 5/6 * 3
    expect(r.partial).toBe(true);
  });
  it('MULTI_BLANK awards credit per blank', () => {
    const q = { ...multiBlank([{ key: 'b1', accepted: ['cat'] }, { key: 'b2', accepted: ['dog'] }]), partialCredit: true, marks: 2 };
    const r = gradeAttempt([q], [{ blanks: { b1: 'cat', b2: 'bird' } }]).perQuestion[0];
    expect(r).toMatchObject({ correct: false, earned: 1, partial: true });
  });
  it('matching-with-mappings awards credit per correct pair', () => {
    const q = { ...matchingMappings([{ left: '1', right: 'x' }, { left: '2', right: 'y' }]), partialCredit: true, marks: 2 };
    const r = gradeAttempt([q], [{ mappings: { '1': 'x', '2': 'z' } }]).perQuestion[0];
    expect(r).toMatchObject({ correct: false, earned: 1, partial: true });
  });
  it('without the partialCredit flag, an incorrect answer earns nothing even if close', () => {
    const q = { ...numerical(42, 0), marks: 5 }; // partialCredit not set
    expect(gradeAttempt([q], [{ value: 41 }]).perQuestion[0]).toMatchObject({ correct: false, earned: 0 });
    expect(gradeAttempt([q], [{ value: 41 }]).perQuestion[0].partial).toBeUndefined();
  });
});

describe('sanitizeAnswer', () => {
  it('rejects malformed or foreign answers', () => {
    const q = mcq(['b']);
    expect(sanitizeAnswer(q, { optionIds: ['b'] })).toEqual({ optionIds: ['b'] });
    expect(sanitizeAnswer(q, { optionIds: ['zzz'] })).toBeNull(); // not an option of this question
    expect(sanitizeAnswer(q, { optionIds: ['a', 'b'] })).toBeNull(); // two answers to a single-choice
    expect(sanitizeAnswer(q, 'b')).toBeNull();
    expect(sanitizeAnswer(tfng('TRUE'), { value: 'MAYBE' })).toBeNull();
    expect(sanitizeAnswer(completion(['x']), { text: 5 })).toBeNull();
    expect(sanitizeAnswer(completion(['x']), { text: 'a'.repeat(501) })).toBeNull();
  });
  it('drops unknown keys so nothing extra is stored', () => {
    expect(sanitizeAnswer(tfng('TRUE'), { value: 'TRUE', isCorrect: true })).toEqual({ value: 'TRUE' });
  });
  it('validates ORDERING answers against the question options', () => {
    const q = ordering(['a', 'b', 'c']);
    expect(sanitizeAnswer(q, { orderedIds: ['c', 'a', 'b'] })).toEqual({ orderedIds: ['c', 'a', 'b'] });
    expect(sanitizeAnswer(q, { orderedIds: ['a', 'a', 'b'] })).toBeNull(); // duplicate
    expect(sanitizeAnswer(q, { orderedIds: ['a', 'z'] })).toBeNull(); // not an option
    expect(sanitizeAnswer(q, { orderedIds: 'a,b,c' })).toBeNull();
  });
  it('validates NUMERICAL answers as finite numbers', () => {
    const q = numerical(42);
    expect(sanitizeAnswer(q, { value: 41.5 })).toEqual({ value: 41.5 });
    expect(sanitizeAnswer(q, { value: '41.5' })).toEqual({ value: 41.5 });
    expect(sanitizeAnswer(q, { value: 'not a number' })).toBeNull();
    expect(sanitizeAnswer(q, { value: Infinity })).toBeNull();
  });
  it('validates MULTI_BLANK answers as a string map', () => {
    const q = multiBlank([{ key: 'b1', accepted: ['cat'] }]);
    expect(sanitizeAnswer(q, { blanks: { b1: 'cat' } })).toEqual({ blanks: { b1: 'cat' } });
    expect(sanitizeAnswer(q, { blanks: { b1: 123 } })).toBeNull();
    expect(sanitizeAnswer(q, { blanks: 'cat' })).toBeNull();
  });
  it('validates mapping-based MATCHING answers', () => {
    const q = matchingMappings([{ left: '1', right: 'x' }]);
    expect(sanitizeAnswer(q, { mappings: { '1': 'x' } })).toEqual({ mappings: { '1': 'x' } });
    expect(sanitizeAnswer(q, { mappings: { '1': 5 } })).toBeNull();
  });
});

describe('gradeAttempt', () => {
  it('sums marks and computes percent', () => {
    const qs = [mcq(['a']), completion(['x']), { ...tfng('TRUE'), marks: 2 }];
    const r = gradeAttempt(qs, [{ optionIds: ['a'] }, { text: 'wrong' }, { value: 'TRUE' }]);
    expect(r).toMatchObject({ raw: 3, max: 4, percent: 75 });
    expect(r.perQuestion.map((p) => p.correct)).toEqual([true, false, true]);
  });
  it('handles an empty paper', () => {
    expect(gradeAttempt([], [])).toMatchObject({ raw: 0, max: 0, percent: 0 });
  });
});

describe('bandFromRaw', () => {
  const rows = [
    { rawMin: 39, rawMax: 40, band: 9 }, { rawMin: 30, rawMax: 31, band: 7 }, { rawMin: 23, rawMax: 25, band: 6 }, { rawMin: 0, rawMax: 3, band: 2 },
    { rawMin: 32, rawMax: 34, band: 7.5 }, { rawMin: 26, rawMax: 29, band: 6.5 },
  ];
  it('looks up a full 40-mark test directly', () => {
    expect(bandFromRaw(rows, 30, 40)).toBe(7);
    expect(bandFromRaw(rows, 40, 40)).toBe(9);
    expect(bandFromRaw(rows, 2, 40)).toBe(2);
  });
  it('scales shorter tests to 40 first', () => {
    expect(bandFromRaw(rows, 15, 20)).toBe(7); // 15/20 = 30/40
    expect(bandFromRaw(rows, 10, 10)).toBe(9);
  });
  it('returns null when there is no table or no matching row', () => {
    expect(bandFromRaw([], 10, 40)).toBeNull();
    expect(bandFromRaw(rows, 20, 40)).toBeNull(); // gap in this sample table
    expect(bandFromRaw(rows, 0, 0)).toBeNull();
  });
});

describe('roundIeltsBand', () => {
  it('rounds the average to the nearest half band, .25 and .75 upward', () => {
    expect(roundIeltsBand([6, 6, 6, 6])).toBe(6);
    expect(roundIeltsBand([6, 6, 6, 7])).toBe(6.5); // 6.25 -> 6.5
    expect(roundIeltsBand([6, 6, 7, 7])).toBe(6.5); // 6.5
    expect(roundIeltsBand([6, 7, 7, 7])).toBe(7); // 6.75 -> 7
    expect(roundIeltsBand([5.5, 6, 6, 6])).toBe(6); // 5.875 -> 6
    expect(roundIeltsBand([5, 5, 5, 5.5])).toBe(5); // 5.125 -> 5
  });
  it('is null for no scores', () => { expect(roundIeltsBand([])).toBeNull(); });
});

describe('validateQuestionDefinition', () => {
  it('flags unpublishable questions', () => {
    expect(validateQuestionDefinition({ type: 'MCQ_SINGLE', options: [{ label: 'a', isCorrect: true }], answerKey: null })).not.toEqual([]);
    expect(validateQuestionDefinition({ type: 'MCQ_SINGLE', options: [{ label: 'a', isCorrect: true }, { label: 'b', isCorrect: true }], answerKey: null })).toContain('Mark exactly one correct option.');
    expect(validateQuestionDefinition({ type: 'TFNG', options: [], answerKey: { value: 'YES' } })).not.toEqual([]);
    expect(validateQuestionDefinition({ type: 'COMPLETION', options: [], answerKey: { accepted: [] } })).not.toEqual([]);
    expect(validateQuestionDefinition({ type: 'MCQ_SINGLE', options: [{ label: 'a', isCorrect: true }, { label: 'A', isCorrect: false }], answerKey: null })).toContain('Option labels must be different.');
  });
  it('accepts valid ones', () => {
    expect(validateQuestionDefinition({ type: 'MCQ_SINGLE', options: [{ label: 'a', isCorrect: true }, { label: 'b', isCorrect: false }], answerKey: null })).toEqual([]);
    expect(validateQuestionDefinition({ type: 'TFNG', options: [], answerKey: { value: 'TRUE' } })).toEqual([]);
    expect(validateQuestionDefinition({ type: 'COMPLETION', options: [], answerKey: { accepted: ['x'] } })).toEqual([]);
  });
  it('flags and accepts ORDERING definitions', () => {
    expect(validateQuestionDefinition({ type: 'ORDERING', options: [{ label: 'a', isCorrect: false }], answerKey: { correctOrder: ['x'] } })).not.toEqual([]);
    expect(validateQuestionDefinition({
      type: 'ORDERING', options: [{ label: 'a', isCorrect: false }, { label: 'b', isCorrect: false }], answerKey: { correctOrder: ['a', 'b'] },
    })).toEqual([]);
  });
  it('flags and accepts NUMERICAL definitions', () => {
    expect(validateQuestionDefinition({ type: 'NUMERICAL', options: [], answerKey: {} })).not.toEqual([]);
    expect(validateQuestionDefinition({ type: 'NUMERICAL', options: [], answerKey: { numericValue: 42, tolerance: -1 } })).toContain('Tolerance must be zero or a positive number.');
    expect(validateQuestionDefinition({ type: 'NUMERICAL', options: [], answerKey: { numericValue: 42 } })).toEqual([]);
  });
  it('flags and accepts MULTI_BLANK definitions', () => {
    expect(validateQuestionDefinition({ type: 'MULTI_BLANK', options: [], answerKey: { blanks: [] } })).not.toEqual([]);
    expect(validateQuestionDefinition({ type: 'MULTI_BLANK', options: [], answerKey: { blanks: [{ key: 'b1', accepted: ['x'] }, { key: 'b1', accepted: ['y'] }] } })).toContain('Blank keys must be unique.');
    expect(validateQuestionDefinition({ type: 'MULTI_BLANK', options: [], answerKey: { blanks: [{ key: 'b1', accepted: ['x'] }] } })).toEqual([]);
  });
  it('MATCHING accepts either mappings or a single correct option', () => {
    expect(validateQuestionDefinition({ type: 'MATCHING', options: [], answerKey: { mappings: [{ left: '1', right: 'x' }] } })).toEqual([]);
    expect(validateQuestionDefinition({ type: 'MATCHING', options: [{ label: 'a', isCorrect: true }, { label: 'b', isCorrect: false }], answerKey: null })).toEqual([]);
    expect(validateQuestionDefinition({ type: 'MATCHING', options: [{ label: 'a', isCorrect: false }], answerKey: null })).not.toEqual([]);
  });
});
