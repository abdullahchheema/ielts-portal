import { roundHalfBand } from '../analytics/band';
/** Pure grading + band-conversion logic. No I/O, so every rule is unit-testable. */

export type QuestionType = 'MCQ_SINGLE' | 'MCQ_MULTI' | 'TFNG' | 'YNNG' | 'MATCHING' | 'COMPLETION' | 'ORDERING' | 'NUMERICAL' | 'MULTI_BLANK';

export interface GradableQuestion {
  type: QuestionType;
  marks: number;
  options: { id: string; isCorrect: boolean }[];
  answerKey: {
    value?: string;
    accepted?: string[];
    /** ORDERING: option IDs in the correct sequence. */
    correctOrder?: string[];
    /** NUMERICAL: the correct value and the absolute tolerance allowed either side of it. */
    numericValue?: number;
    tolerance?: number;
    /** MULTI_BLANK: each blank's key and its accepted answer variants. */
    blanks?: { key: string; accepted: string[] }[];
    /** MATCHING: explicit left/right pairs. When absent, MATCHING falls back to single-correct-option behavior. */
    mappings?: { left: string; right: string }[];
  } | null;
  /** When true, MCQ_MULTI/MATCHING/ORDERING/MULTI_BLANK award proportional credit instead of all-or-nothing. */
  partialCredit?: boolean;
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
export function sanitizeAnswer(q: Pick<GradableQuestion, 'type' | 'options' | 'answerKey'>, raw: unknown): Record<string, unknown> | null {
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
    case 'MCQ_MULTI': {
      if (!Array.isArray(a.optionIds) || a.optionIds.some((x) => typeof x !== 'string')) return null;
      const ids = [...new Set(a.optionIds as string[])];
      const valid = new Set(q.options.map((o) => o.id));
      if (ids.some((i) => !valid.has(i))) return null;
      if (q.type !== 'MCQ_MULTI' && ids.length > 1) return null;
      return { optionIds: ids };
    }
    case 'MATCHING': {
      // Mapping-based matching: answer is { mappings: Record<left, right> }.
      if (q.answerKey?.mappings?.length) {
        if (typeof a.mappings !== 'object' || a.mappings === null || Array.isArray(a.mappings)) return null;
        const entries = Object.entries(a.mappings as Record<string, unknown>);
        if (entries.some(([, v]) => typeof v !== 'string')) return null;
        return { mappings: Object.fromEntries(entries) };
      }
      // Legacy single-correct-option matching.
      if (!Array.isArray(a.optionIds) || a.optionIds.some((x) => typeof x !== 'string')) return null;
      const ids = [...new Set(a.optionIds as string[])];
      const valid = new Set(q.options.map((o) => o.id));
      if (ids.some((i) => !valid.has(i))) return null;
      return { optionIds: ids };
    }
    case 'ORDERING': {
      if (!Array.isArray(a.orderedIds) || a.orderedIds.some((x) => typeof x !== 'string')) return null;
      const ids = a.orderedIds as string[];
      const valid = new Set(q.options.map((o) => o.id));
      if (ids.some((i) => !valid.has(i)) || new Set(ids).size !== ids.length) return null;
      return { orderedIds: ids };
    }
    case 'NUMERICAL': {
      const value = typeof a.value === 'number' ? a.value : typeof a.value === 'string' ? Number(a.value) : NaN;
      return Number.isFinite(value) ? { value } : null;
    }
    case 'MULTI_BLANK': {
      if (typeof a.blanks !== 'object' || a.blanks === null || Array.isArray(a.blanks)) return null;
      const entries = Object.entries(a.blanks as Record<string, unknown>);
      if (entries.some(([, v]) => typeof v !== 'string' || (v as string).length > 500)) return null;
      return { blanks: Object.fromEntries(entries) };
    }
    default:
      return null;
  }
}

function isCorrectMcq(q: GradableQuestion, a: Record<string, unknown>): boolean {
  const chosen = new Set(Array.isArray(a.optionIds) ? (a.optionIds as string[]) : []);
  const correct = new Set(q.options.filter((o) => o.isCorrect).map((o) => o.id));
  return chosen.size > 0 && chosen.size === correct.size && [...chosen].every((c) => correct.has(c));
}

function isCorrectMapping(q: GradableQuestion, a: Record<string, unknown>): boolean {
  const mappings = q.answerKey?.mappings ?? [];
  const given = (a.mappings ?? {}) as Record<string, string>;
  if (mappings.length === 0) return false;
  return mappings.every((m) => given[m.left] === m.right);
}

function isCorrectOrdering(q: GradableQuestion, a: Record<string, unknown>): boolean {
  const expected = q.answerKey?.correctOrder ?? [];
  const given = Array.isArray(a.orderedIds) ? (a.orderedIds as string[]) : [];
  return expected.length > 0 && expected.length === given.length && expected.every((id, i) => given[i] === id);
}

function isCorrectNumerical(q: GradableQuestion, a: Record<string, unknown>): boolean {
  const target = q.answerKey?.numericValue;
  const tolerance = q.answerKey?.tolerance ?? 0;
  const given = typeof a.value === 'number' ? a.value : NaN;
  return typeof target === 'number' && Number.isFinite(given) && Math.abs(given - target) <= tolerance;
}

function isCorrectMultiBlank(q: GradableQuestion, a: Record<string, unknown>): boolean {
  const blanks = q.answerKey?.blanks ?? [];
  const given = (a.blanks ?? {}) as Record<string, string>;
  if (blanks.length === 0) return false;
  return blanks.every((b) => {
    const value = given[b.key];
    if (typeof value !== 'string') return false;
    const normalized = normalizeText(value);
    return normalized !== '' && b.accepted.some((ok) => normalizeText(ok) === normalized);
  });
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
    case 'MCQ_MULTI':
      return isCorrectMcq(q, a);
    case 'MATCHING':
      return q.answerKey?.mappings?.length ? isCorrectMapping(q, a) : isCorrectMcq(q, a);
    case 'ORDERING':
      return isCorrectOrdering(q, a);
    case 'NUMERICAL':
      return isCorrectNumerical(q, a);
    case 'MULTI_BLANK':
      return isCorrectMultiBlank(q, a);
    default:
      return false;
  }
}

/**
 * Proportional credit in [0, 1] for question types that support it. Returns null when the type has no
 * partial-credit notion (TFNG, YNNG, COMPLETION, NUMERICAL are all-or-nothing regardless of the flag).
 */
function partialCreditFraction(q: GradableQuestion, answer: unknown): number | null {
  const a = (answer ?? {}) as Record<string, unknown>;
  switch (q.type) {
    case 'MCQ_MULTI': {
      const chosen = new Set(Array.isArray(a.optionIds) ? (a.optionIds as string[]) : []);
      const correct = new Set(q.options.filter((o) => o.isCorrect).map((o) => o.id));
      if (correct.size === 0) return 0;
      const hits = [...chosen].filter((c) => correct.has(c)).length;
      const misses = [...chosen].filter((c) => !correct.has(c)).length;
      return Math.max(0, (hits - misses) / correct.size);
    }
    case 'MATCHING': {
      const mappings = q.answerKey?.mappings ?? [];
      if (mappings.length === 0) return null;
      const given = (a.mappings ?? {}) as Record<string, string>;
      const hits = mappings.filter((m) => given[m.left] === m.right).length;
      return hits / mappings.length;
    }
    case 'ORDERING': {
      const expected = q.answerKey?.correctOrder ?? [];
      const given = Array.isArray(a.orderedIds) ? (a.orderedIds as string[]) : [];
      if (expected.length < 2) return null;
      // Count adjacent pairs in `given` whose relative order matches `expected`.
      const position = new Map(expected.map((id, i) => [id, i]));
      let correctPairs = 0;
      let totalPairs = 0;
      for (let i = 0; i < given.length; i++) {
        for (let j = i + 1; j < given.length; j++) {
          const pi = position.get(given[i]);
          const pj = position.get(given[j]);
          if (pi === undefined || pj === undefined) continue;
          totalPairs++;
          if (pi < pj) correctPairs++;
        }
      }
      return totalPairs > 0 ? correctPairs / totalPairs : 0;
    }
    case 'MULTI_BLANK': {
      const blanks = q.answerKey?.blanks ?? [];
      if (blanks.length === 0) return null;
      const given = (a.blanks ?? {}) as Record<string, string>;
      const hits = blanks.filter((b) => {
        const value = given[b.key];
        if (typeof value !== 'string') return false;
        const normalized = normalizeText(value);
        return normalized !== '' && b.accepted.some((ok) => normalizeText(ok) === normalized);
      }).length;
      return hits / blanks.length;
    }
    default:
      return null;
  }
}

export interface GradeResult {
  perQuestion: { index: number; correct: boolean; earned: number; partial?: boolean }[];
  raw: number;
  max: number;
  percent: number;
}

export function gradeAttempt(questions: GradableQuestion[], answers: (unknown | undefined)[]): GradeResult {
  let raw = 0;
  let max = 0;
  const perQuestion = questions.map((q, index) => {
    const correct = isCorrect(q, answers[index]);
    let earned = correct ? q.marks : 0;
    let partial = false;
    if (!correct && q.partialCredit) {
      const fraction = partialCreditFraction(q, answers[index]);
      if (fraction !== null && fraction > 0) {
        earned = Math.round(fraction * q.marks * 100) / 100;
        partial = true;
      }
    }
    raw += earned;
    max += q.marks;
    return { index, correct, earned, ...(partial ? { partial } : {}) };
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
  answerKey: GradableQuestion['answerKey'];
}

/** Returns a list of human-readable problems; empty means the question is publishable. */
export function validateQuestionDefinition(q: DraftQuestion): string[] {
  const problems: string[] = [];
  switch (q.type) {
    case 'MCQ_SINGLE':
      if (q.options.length < 2) problems.push('Needs at least 2 options.');
      if (q.options.filter((o) => o.isCorrect).length !== 1) problems.push('Mark exactly one correct option.');
      break;
    case 'MATCHING':
      if (q.answerKey?.mappings?.length) {
        if (q.answerKey.mappings.some((m) => !m.left || !m.right)) problems.push('Every mapping needs a left and right value.');
      } else {
        if (q.options.length < 2) problems.push('Needs at least 2 options.');
        if (q.options.filter((o) => o.isCorrect).length !== 1) problems.push('Mark exactly one correct option, or provide mappings.');
      }
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
    case 'ORDERING':
      if (!q.answerKey?.correctOrder || q.answerKey.correctOrder.length < 2) problems.push('Provide a correct order with at least 2 items.');
      if (q.options.length !== (q.answerKey?.correctOrder?.length ?? 0)) problems.push('The number of options must match the correct order.');
      break;
    case 'NUMERICAL':
      if (typeof q.answerKey?.numericValue !== 'number' || !Number.isFinite(q.answerKey.numericValue)) problems.push('Provide a numeric answer.');
      if (q.answerKey?.tolerance !== undefined && (q.answerKey.tolerance < 0 || !Number.isFinite(q.answerKey.tolerance))) problems.push('Tolerance must be zero or a positive number.');
      break;
    case 'MULTI_BLANK':
      if (!q.answerKey?.blanks?.length) problems.push('Provide at least one blank.');
      if (q.answerKey?.blanks?.some((b) => !b.key || !b.accepted?.length)) problems.push('Every blank needs a key and at least one accepted answer.');
      if (new Set(q.answerKey?.blanks?.map((b) => b.key)).size !== (q.answerKey?.blanks?.length ?? 0)) problems.push('Blank keys must be unique.');
      break;
  }
  if (new Set(q.options.map((o) => o.label.trim().toLowerCase())).size !== q.options.length) problems.push('Option labels must be different.');
  return problems;
}
