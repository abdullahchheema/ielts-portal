/**
 * Feedback and NPS. Pure: no database, no clock. The service does the reads and writes; these functions decide
 * what a score means, what gets stored for an anonymous response, and what the dashboard may show.
 */

/** Below this many responses a score or a group is not shown: one or two people must not be identifiable from a figure. */
export const MIN_RESPONSES = 5;

export type NpsCategory = 'PROMOTER' | 'PASSIVE' | 'DETRACTOR';

export function categorize(score: number): NpsCategory {
  if (score >= 9) return 'PROMOTER';
  if (score >= 7) return 'PASSIVE';
  return 'DETRACTOR';
}

export interface NpsSummary {
  responses: number;
  promoters: number;
  passives: number;
  detractors: number;
  /** Null when there are too few responses to show a score. */
  nps: number | null;
  /** Null when no requests were sent in the period. */
  responseRate: number | null;
  suppressed: boolean;
}

/** NPS = % promoters minus % detractors, from -100 to 100. Response rate is responses over requests sent. */
export function npsSummary(scores: number[], requestsSent: number): NpsSummary {
  const responses = scores.length;
  const promoters = scores.filter((s) => categorize(s) === 'PROMOTER').length;
  const detractors = scores.filter((s) => categorize(s) === 'DETRACTOR').length;
  const passives = responses - promoters - detractors;
  const suppressed = responses < MIN_RESPONSES;
  return {
    responses,
    promoters: suppressed ? 0 : promoters,
    passives: suppressed ? 0 : passives,
    detractors: suppressed ? 0 : detractors,
    nps: suppressed ? null : Math.round(((promoters - detractors) / responses) * 100),
    responseRate: requestsSent > 0 ? Math.round((responses / requestsSent) * 100) : null,
    suppressed,
  };
}

/** Month-by-month NPS in UTC, oldest first. Months under the minimum are returned without a score. */
export function monthlyTrend(rows: { score: number; at: Date }[]): { month: string; responses: number; nps: number | null }[] {
  const byMonth = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${r.at.getUTCFullYear()}-${String(r.at.getUTCMonth() + 1).padStart(2, '0')}`;
    byMonth.set(key, [...(byMonth.get(key) ?? []), r.score]);
  }
  return [...byMonth.keys()].sort().map((month) => {
    const scores = byMonth.get(month)!;
    return { month, responses: scores.length, nps: npsSummary(scores, 0).nps };
  });
}

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'always', 'another', 'because', 'been', 'before', 'being', 'could', 'does', 'doing', 'down',
  'during', 'even', 'every', 'from', 'have', 'here', 'into', 'just', 'like', 'many', 'more', 'most', 'much', 'myself', 'never',
  'only', 'other', 'over', 'really', 'should', 'some', 'still', 'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'very', 'want', 'were', 'what', 'when', 'where', 'which', 'while', 'with', 'would', 'your',
]);

/**
 * Recurring words in the comments, most frequent first. Deterministic: the same comments always give the same themes.
 * Short words and common filler are ignored. Themes are shown only when enough comments exist to be meaningful.
 */
export function themes(comments: string[], top = 8): { word: string; count: number }[] {
  if (comments.length < MIN_RESPONSES) return [];
  const counts = new Map<string, number>();
  for (const text of comments) {
    const words = new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);
    for (const w of words) if (!STOP_WORDS.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, top)
    .map(([word, count]) => ({ word, count }));
}

export interface ResponseInput {
  surveyId: string;
  batchId: string | null;
  trigger: string;
  studentId: string;
  requestId: string;
  score: number;
  anonymous: boolean;
  comments: { overall?: string; teacher?: string; course?: string; technical?: string };
}

/**
 * The row to store for a response. An anonymous response keeps the survey, batch, trigger, score and comments,
 * and nothing that links it to the student or to their request. This is the only place that decides that.
 */
export function responseRecord(input: ResponseInput) {
  const c = input.comments;
  const base = {
    surveyId: input.surveyId,
    batchId: input.batchId,
    triggerKind: input.trigger,
    anonymous: input.anonymous,
    score: input.score,
    commentOverall: c.overall?.trim() || null,
    commentTeacher: c.teacher?.trim() || null,
    commentCourse: c.course?.trim() || null,
    commentTechnical: c.technical?.trim() || null,
  };
  return input.anonymous ? { ...base, studentId: null, requestId: null } : { ...base, studentId: input.studentId, requestId: input.requestId };
}
