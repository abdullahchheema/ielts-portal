/**
 * Pure scheduling rules. No database and no clock: `now` is passed in.
 */

/** A task is due when it has never run, or its last run is at least `everyMs` old. */
export function isDue(lastRunAt: Date | null, everyMs: number, now: Date): boolean {
  return !lastRunAt || now.getTime() - lastRunAt.getTime() >= everyMs;
}

/** Retry delay for a failed job: 1 min, 2, 4, 8 ... capped at 1 hour. */
export function backoffMs(attempts: number): number {
  return Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));
}

/** Failed jobs stop retrying after this many attempts and stay FAILED for a human to look at. */
export const MAX_JOB_ATTEMPTS = 5;
