/**
 * Approximate raw-score-to-band conversion for IELTS Listening and Reading (Academic).
 * Published conversion tables vary slightly between test versions — treat the result as
 * an estimate, not an official score. Reading table differs slightly for General Training
 * in the lower range; this uses the commonly published Academic table for both tools.
 */
const LISTENING_TABLE: [min: number, band: number][] = [
  [39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5], [23, 6],
  [18, 5.5], [16, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5],
];

const READING_TABLE: [min: number, band: number][] = [
  [39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6],
  [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5],
];

function lookup(table: [number, number][], raw: number): number {
  const clamped = Math.max(0, Math.min(40, Math.round(raw)));
  for (const [min, band] of table) if (clamped >= min) return band;
  return 2;
}

export const listeningBand = (raw: number) => lookup(LISTENING_TABLE, raw);
export const readingBand = (raw: number) => lookup(READING_TABLE, raw);
