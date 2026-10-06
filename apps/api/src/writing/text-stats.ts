/**
 * Measurements of an essay that need no AI: counts, repetition and a list of weak phrases.
 * These are shown as supporting facts beside any estimate. They are not IELTS scoring criteria.
 */

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'this', 'that', 'these', 'those', 'as', 'i', 'you', 'he', 'she', 'we', 'they', 'my', 'your', 'their', 'our', 'its', 'not', 'so', 'if', 'than', 'then', 'there', 'have', 'has', 'had', 'do', 'does', 'did', 'can', 'will', 'would', 'should', 'could', 'may', 'might', 'also']);

/** Phrases that are common in weak IELTS writing. The list is short on purpose, so every flag is worth reading. */
export const WEAK_PHRASES: { phrase: RegExp; suggestion: string }[] = [
  { phrase: /\ba lot of\b/i, suggestion: 'many / a considerable number of / a large proportion of' },
  { phrase: /\bthings\b/i, suggestion: 'name the specific thing (factors, aspects, issues)' },
  { phrase: /\bgood\b/i, suggestion: 'beneficial / effective / valuable / advantageous' },
  { phrase: /\bbad\b/i, suggestion: 'harmful / detrimental / unfavourable / problematic' },
  { phrase: /\bvery\s+\w+/i, suggestion: 'use a stronger single adjective or adverb instead of "very + word"' },
  { phrase: /\bin my opinion\b/i, suggestion: 'It seems to me that / I firmly believe that (once is enough)' },
  { phrase: /\bnowadays\b/i, suggestion: 'in contemporary society / in the modern era' },
  { phrase: /\bkids\b/i, suggestion: 'children / young people' },
  { phrase: /\bget\b/i, suggestion: 'obtain / acquire / receive / become (choose by meaning)' },
];

export interface TextStats {
  words: number;
  sentences: number;
  paragraphs: number;
  typeTokenRatio: number;
  repeatedWords: { word: string; count: number }[];
  weakPhrases: { match: string; suggestion: string }[];
}

export function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z’'-]+/g) ?? [];
}

export function wordCount(text: string): number {
  return wordsOf(text).length;
}

export function paragraphCount(text: string): number {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).length;
}

export function sentenceCount(text: string): number {
  return text.split(/[.!?]+(?=\s|$)/).map((s) => s.trim()).filter((s) => /[a-z]/i.test(s)).length;
}

/** Distinct words divided by all words. Higher means a wider vocabulary, though it falls as texts get longer. */
export function typeTokenRatio(text: string): number {
  const w = wordsOf(text);
  if (w.length === 0) return 0;
  return Math.round((new Set(w).size / w.length) * 100) / 100;
}

/** Content words used at least `minCount` times, most frequent first. Stop words are ignored. */
export function repeatedWords(text: string, minCount = 4, limit = 8): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const w of wordsOf(text)) {
    if (w.length < 4 || STOP.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

export function weakPhrasesIn(text: string): { match: string; suggestion: string }[] {
  const out: { match: string; suggestion: string }[] = [];
  for (const { phrase, suggestion } of WEAK_PHRASES) {
    const m = text.match(phrase);
    if (m) out.push({ match: m[0], suggestion });
  }
  return out;
}

export function textStats(text: string): TextStats {
  return {
    words: wordCount(text),
    sentences: sentenceCount(text),
    paragraphs: paragraphCount(text),
    typeTokenRatio: typeTokenRatio(text),
    repeatedWords: repeatedWords(text),
    weakPhrases: weakPhrasesIn(text),
  };
}

/** Task 1 needs at least 150 words and Task 2 at least 250. Shown as guidance; a shorter essay is still saved and evaluated. */
export const MIN_WORDS: Record<'TASK1' | 'TASK2', number> = { TASK1: 150, TASK2: 250 };
