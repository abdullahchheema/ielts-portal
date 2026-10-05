import { roundHalfBand } from '../analytics/band';
/** Pure grading + band-conversion logic. No I/O, so every rule is unit-testable. */

export type QuestionType = 'MCQ_SINGLE' | 'MCQ_MULTI' | 'TFNG' | 'YNNG' | 'MATCHING' | 'COMPLETION';

export interface GradableQuestion {
  type: QuestionType;
  marks: number;
  options: { id: string; isCorrect: boolean }[];
  answerKey: { value?: string; accepted?: string[] } | null;
}

const TFNG_VALUES = ['TRUE', 'FALSE', 'NOT_GIVEN'];
const YNNG_VALUES = ['YES', 'NO', 'NOT_GIVEN'];

/** Lowercase, collapse whitespace, strip surrounding punctuation. "  The  Library. " -> "the library" */
export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/^[.,;:!?'"]+|[.,;:!?'"]+$/g, '').trim();
}

/**
 * Validates and canonicalises a student's raw answer for a question. Returns null if the shape is unusable
 * (so a malformed autosave is rejected rather than silently stored).
 */
export function sanitizeAnswer(q: Pick<GradableQuestion, 'type' | 'options'>, raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  switch (q.type) {
    case 'TFNG':
    case 'YNNG': {
      const allowed = q.type === 'TFNG' ? TFNG_VALUES : YNNG_VALUES;
      return typeof a.value === 'string' && allowed.includes(a.value) ? { value: a.value } : null;
    }
    case 'COMPLETION':
      return typeof a.text === 'string' && a.text.length <= 500 ? { text: a.text } : null;
    case 'MCQ_SINGLE':
    case 'MATCHING':
    case 'MCQ_MULTI': {
      if (!Array.isArray(a.optionIds) || a.optionIds.some((x) => typeof x !== 'string')) return null;
      const ids = [...new Set(a.optionIds as string[])];
      const valid = new Set(q.options.map((o) => o.id));
      if (ids.some((i) => !valid.has(i))) return null;
      if (q.type !== 'MCQ_MULTI' && ids.length > 1) return null;
      return { optionIds: ids };
    }
    default:
      return null;
  }
}

/** All-or-nothing per question. A blank answer is simply incorrect. */
export function isCorrect(q: GradableQuestion, answer: unknown): boolean {
  const a = (answer ?? {}) as Record<string, unknown>;
  switch (q.type) {
    case 'TFNG':
    case 'YNNG':
      return typeof a.value === 'string' && a.value === q.answerKey?.value;
    case 'COMPLETION': {
      if (typeof a.text !== 'string') return false;
      const given = normalizeText(a.text);
      return given !== '' && (q.answerKey?.accepted ?? []).some((ok) => normalizeText(ok) === given);
    }
    case 'MCQ_SINGLE':
    case 'MATCHING':
    case 'MCQ_MULTI': {
      const chosen = new Set(Array.isArray(a.optionIds) ? (a.optionIds as string[]) : []);
      const correct = new Set(q.options.filter((o) => o.isCorrect).map((o) => o.id));
      return chosen.size > 0 && chosen.size === correct.size && [...chosen].every((c) => correct.has(c));
    }
    default:
      return false;
  }
}

export interface GradeResult {
  perQuestion: { index: number; correct: boolean; earned: number }[];
  raw: number;
  max: number;
  percent: number;
}

export function gradeAttempt(questions: GradableQuestion[], answers: (unknown | undefined)[]): GradeResult {
  let raw = 0;
  let max = 0;
  const perQuestion = questions.map((q, index) => {
    const correct = isCorrect(q, answers[index]);
    const earned = correct ? q.marks : 0;
    raw += earned;
    max += q.marks;
    return { index, correct, earned };
  });
  const percent = max > 0 ? Math.round((raw / max) * 10_000) / 100 : 0;
  return { perQuestion, raw, max, percent };
}

export interface BandRow { rawMin: number; rawMax: number; band: number }

/** Scales to a 40-mark test (shorter quizzes are not comparable otherwise), then looks the band up in the table. */
export function bandFromRaw(rows: BandRow[], raw: number, max: number): number | null {
  if (max <= 0 || rows.length === 0) return null;
  const scaled = Math.round((raw / max) * 40);
  const row = rows.find((r) => scaled >= r.rawMin && scaled <= r.rawMax);
  return row ? row.band : null;
}

/** IELTS rounding of an average of criterion bands: to the nearest half band, .25 and .75 round UP. */
export function roundIeltsBand(values: number[]): number | null {
  if (values.length === 0) return null;
  return roundHalfBand(values.reduce((s, v) => s + v, 0) / values.length);
}

// ── authoring-time validation ──
export interface DraftQuestion {
  type: QuestionType;
  options: { label: string; isCorrect: boolean }[];
  answerKey: { value?: string; accepted?: string[] } | null;
}

/** Returns a list of human-readable problems; empty means the question is publishable. */
export function validateQuestionDefinition(q: DraftQuestion): string[] {
  const problems: string[] = [];
  switch (q.type) {
    case 'MCQ_SINGLE':
    case 'MATCHING':
      if (q.options.length < 2) problems.push('Needs at least 2 options.');
      if (q.options.filter((o) => o.isCorrect).length !== 1) problems.push('Mark exactly one correct option.');
      break;
    case 'MCQ_MULTI':
      if (q.options.length < 3) problems.push('Needs at least 3 options.');
      if (q.options.filter((o) => o.isCorrect).length < 2) problems.push('Mark at least two correct options.');
      break;
    case 'TFNG':
      if (!q.answerKey?.value || !TFNG_VALUES.includes(q.answerKey.value)) problems.push('Answer must be TRUE, FALSE or NOT_GIVEN.');
      break;
    case 'YNNG':
      if (!q.answerKey?.value || !YNNG_VALUES.includes(q.answerKey.value)) problems.push('Answer must be YES, NO or NOT_GIVEN.');
      break;
    case 'COMPLETION':
      if (!q.answerKey?.accepted?.length) problems.push('Provide at least one accepted answer.');
      break;
  }
  if (new Set(q.options.map((o) => o.label.trim().toLowerCase())).size !== q.options.length) problems.push('Option labels must be different.');
  return problems;
}
