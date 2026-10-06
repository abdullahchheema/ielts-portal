/**
 * Deterministic study plan allocation. Pure: the same inputs always give the same plan.
 * AI may write the summary text around a plan, but it never chooses which tasks exist.
 */

export interface Candidate {
  key: string;
  skill: string;
  kind: string;
  refType: string;
  refId: string;
  title: string;
  minutes: number;
  /** Higher means more needed. Weak areas come first. */
  weight: number;
  rationale: string;
}

export interface PlannedDay { dayIndex: number; minutes: number; tasks: (Candidate & { sort: number })[] }

/**
 * Spreads the candidates across the days, heaviest first, never exceeding `minutesPerDay` on any day. A task is
 * placed once. Tasks that do not fit are left out rather than squeezed in.
 */
export function allocate(cands: Candidate[], days: number, minutesPerDay: number): PlannedDay[] {
  const out: PlannedDay[] = Array.from({ length: Math.max(0, days) }, (_, i) => ({ dayIndex: i, minutes: 0, tasks: [] }));
  if (out.length === 0) return out;
  const ranked = [...cands].sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
  let cursor = 0;
  for (const c of ranked) {
    for (let attempt = 0; attempt < out.length; attempt++) {
      const day = out[(cursor + attempt) % out.length];
      if (day.minutes + c.minutes <= minutesPerDay) {
        day.tasks.push({ ...c, sort: day.tasks.length });
        day.minutes += c.minutes;
        cursor = (cursor + attempt + 1) % out.length;
        break;
      }
    }
  }
  return out;
}

/** Whether a plan is on track for the exam date: total planned minutes against the amount a student needs. */
export function planStatus(args: { gapBands: number | null; daysLeft: number | null; minutesPlanned: number; minutesPerDay: number }) {
  if (args.gapBands === null) return 'NO_TARGET' as const;
  if (args.daysLeft === null) return 'NO_EXAM_DATE' as const;
  const needed = args.gapBands <= 0 ? 0 : args.gapBands * 120;
  return args.minutesPlanned >= needed ? ('ON_TRACK' as const) : ('NEEDS_IMPROVEMENT' as const);
}
