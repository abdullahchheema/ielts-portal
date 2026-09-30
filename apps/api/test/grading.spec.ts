import { describe, expect, it } from 'vitest';
import {
  GradableQuestion, bandFromRaw, gradeAttempt, isCorrect, normalizeText, roundIeltsBand, sanitizeAnswer, validateQuestionDefinition,
} from '../src/assessments/grading';

const mcq = (correct: string[], all = ['a', 'b', 'c'], type: 'MCQ_SINGLE' | 'MCQ_MULTI' = 'MCQ_SINGLE'): GradableQuestion => ({
  type, marks: 1, answerKey: null, options: all.map((id) => ({ id, isCorrect: correct.includes(id) })),
});
const completion = (accepted: string[]): GradableQuestion => ({ type: 'COMPLETION', marks: 1, options: [], answerKey: { accepted } });
const tfng = (value: string): GradableQuestion => ({ type: 'TFNG', marks: 1, options: [], answerKey: { value } });

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
});
