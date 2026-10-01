/** Minimal shape of a StudentProfile needed to summarize its IELTS history. Decimal fields may arrive
 * as Prisma.Decimal, string or number depending on the caller — all are coerced to `number`. */
export interface IeltsSummarySource {
  ieltsHistory?: string | null;
  ieltsOverall?: unknown;
  ieltsListening?: unknown;
  ieltsReading?: unknown;
  ieltsWriting?: unknown;
  ieltsSpeaking?: unknown;
  ieltsTestDate?: Date | string | null;
  ieltsAttempts?: number | null;
}

export interface IeltsSummary {
  status: 'NOT_TAKEN' | 'TAKEN';
  overall: number | null;
  listening: number | null;
  reading: number | null;
  writing: number | null;
  speaking: number | null;
  testDate: Date | string | null;
  attempts: number | null;
}

const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Builds a structured IELTS summary for a student profile, used anywhere a student's band is surfaced. */
export function ieltsSummary(profile: IeltsSummarySource): IeltsSummary {
  const taken = profile.ieltsHistory === 'TAKEN';
  return {
    status: taken ? 'TAKEN' : 'NOT_TAKEN',
    overall: taken ? toNumber(profile.ieltsOverall) : null,
    listening: taken ? toNumber(profile.ieltsListening) : null,
    reading: taken ? toNumber(profile.ieltsReading) : null,
    writing: taken ? toNumber(profile.ieltsWriting) : null,
    speaking: taken ? toNumber(profile.ieltsSpeaking) : null,
    testDate: taken ? (profile.ieltsTestDate ?? null) : null,
    attempts: taken ? (profile.ieltsAttempts ?? null) : null,
  };
}
