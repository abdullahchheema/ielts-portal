/**
 * Maps a grammar note from AI feedback onto a fixed category. Pure. Rules are deliberately narrow: a note that
 * matches no rule goes to OTHER rather than being guessed into a category.
 */

export const GRAMMAR_CODES = ['ARTICLES', 'TENSES', 'PREPOSITIONS', 'SUBJECT_VERB', 'WORD_FORM', 'FRAGMENTS', 'RUN_ONS', 'CONDITIONALS', 'COMPLEX', 'PUNCTUATION', 'OTHER'] as const;
export type GrammarCode = (typeof GRAMMAR_CODES)[number];

const RULES: { code: GrammarCode; test: RegExp }[] = [
  { code: 'CONDITIONALS', test: /\b(conditional|if clause|would have|third conditional|second conditional|first conditional)\b/i },
  { code: 'ARTICLES', test: /\b(article|definite|indefinite)\b|\b(missing|unnecessary) (the|a|an)\b/i },
  { code: 'PREPOSITIONS', test: /\bpreposition|\b(in|on|at|for|with|by|to) (the|a)?\b.*\b(instead|should be|use)\b/i },
  { code: 'SUBJECT_VERB', test: /\b(subject|verb agreement|agree|singular|plural)\b/i },
  { code: 'WORD_FORM', test: /\b(word form|noun form|adjective form|adverb form|should be an? (noun|adjective|adverb|verb))\b/i },
  { code: 'TENSES', test: /\b(tense|past simple|present perfect|past perfect|continuous|future form)\b/i },
  { code: 'FRAGMENTS', test: /\b(fragment|incomplete sentence|missing (a )?verb|no main verb)\b/i },
  { code: 'RUN_ONS', test: /\b(run-on|comma splice|fused sentence)\b/i },
  { code: 'PUNCTUATION', test: /\b(punctuation|comma|apostrophe|semicolon|full stop)\b/i },
  { code: 'COMPLEX', test: /\b(subordinat|relative clause|complex sentence|clause)\b/i },
];

export function categorize(note: string): GrammarCode {
  for (const r of RULES) if (r.test.test(note)) return r.code;
  return 'OTHER';
}

/** Share of observations in each category, and the change over the last two calendar months. */
export function monthlyTrend(current: number, previous: number): { direction: 'UP' | 'DOWN' | 'SAME' | 'NEW'; percent: number | null } {
  if (previous === 0) return current === 0 ? { direction: 'SAME', percent: null } : { direction: 'NEW', percent: null };
  const change = Math.round(((current - previous) / previous) * 100);
  return { direction: change > 0 ? 'UP' : change < 0 ? 'DOWN' : 'SAME', percent: Math.abs(change) };
}
