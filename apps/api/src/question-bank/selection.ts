/**
 * Question selection as pure functions. The same seed always yields the same selection, so a practice
 * session can be reproduced and tested. No database and no clock.
 */

export interface BankCandidate {
  id: string;
  setId: string;
  difficulty: number;
  topic: string | null;
  ieltsType: string;
}

export interface SelectionOptions {
  count: number;
  /** Anything stable for this selection, e.g. student id plus date. */
  seed: string;
  difficulty?: { min: number; max: number };
  topic?: string;
  ieltsTypes?: string[];
  /** Questions to avoid, e.g. ones this student answered recently. Dropped if they leave too few candidates. */
  exclude?: Set<string>;
}

/** 32-bit FNV-1a. Good enough for a stable shuffle; not for security. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function filterCandidates(cands: BankCandidate[], o: SelectionOptions, exclude: Set<string> | undefined) {
  return cands.filter((c) =>
    (!o.difficulty || (c.difficulty >= o.difficulty.min && c.difficulty <= o.difficulty.max))
    && (!o.topic || c.topic === o.topic)
    && (!o.ieltsTypes?.length || o.ieltsTypes.includes(c.ieltsType))
    && !(exclude?.has(c.id)));
}

function pick(cands: BankCandidate[], count: number, seed: string): string[] {
  const ranked = cands
    .map((c) => ({ c, k: fnv1a(`${seed}|${c.id}`) }))
    .sort((a, b) => a.k - b.k || (a.c.id < b.c.id ? -1 : 1));
  const chosen: string[] = [];
  const seenSets = new Set<string>();
  // First pass: at most one question per set, so one long passage does not fill the whole paper.
  for (const { c } of ranked) {
    if (chosen.length >= count) break;
    if (seenSets.has(c.setId)) continue;
    seenSets.add(c.setId);
    chosen.push(c.id);
  }
  // Second pass: fill any remaining places from the same ranking.
  for (const { c } of ranked) {
    if (chosen.length >= count) break;
    if (!chosen.includes(c.id)) chosen.push(c.id);
  }
  return chosen;
}

/**
 * Returns up to `count` question ids. Excluded questions are used only when skipping them would leave the
 * selection short, so a student who has seen everything still gets a full practice set.
 */
export function selectCandidates(cands: BankCandidate[], o: SelectionOptions): string[] {
  const fresh = pick(filterCandidates(cands, o, o.exclude), o.count, o.seed);
  if (fresh.length >= o.count) return fresh;
  const all = pick(filterCandidates(cands, o, undefined), o.count, o.seed);
  return all;
}
