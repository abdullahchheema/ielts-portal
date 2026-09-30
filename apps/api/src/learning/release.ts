import type { ErrorCode } from '@ielts/types';

export type ReleaseType = 'IMMEDIATE' | 'BATCH_DATE' | 'RELATIVE' | 'PREREQUISITE' | 'SCORE_BASED' | 'MANUAL';

export interface ReleaseInput {
  releaseType: ReleaseType;
  releaseValue: unknown;
}

export interface ReleaseContext {
  now: Date;
  batchStartAt: Date;
  /** Ids of content items the student has COMPLETED in this enrollment. */
  completedItemIds: ReadonlySet<string>;
  /** Ids of items that exist and are published in this version (a prerequisite must be one of these). */
  publishedItemIds: ReadonlySet<string>;
  /** Best submitted score (%) per content item that is backed by an assessment. */
  bestScorePercentByItemId?: ReadonlyMap<string, number>;
}

export type ReleaseState =
  | { unlocked: true }
  | { unlocked: false; code: ErrorCode; reason: string; availableAt?: Date; requiredItemId?: string };

const DAY_MS = 86_400_000;

/** Pure function: is this item available to the student right now, and if not, why. */
export function evaluateRelease(item: ReleaseInput, ctx: ReleaseContext): ReleaseState {
  const value = (item.releaseValue ?? {}) as { date?: string; days?: number; requiredItemId?: string; minScorePercent?: number };

  switch (item.releaseType) {
    case 'IMMEDIATE':
      return { unlocked: true };

    case 'BATCH_DATE': {
      const at = value.date ? new Date(value.date) : undefined;
      if (!at || Number.isNaN(at.getTime())) return { unlocked: false, code: 'CONTENT_NOT_RELEASED', reason: 'Release date is not configured.' };
      return ctx.now >= at
        ? { unlocked: true }
        : { unlocked: false, code: 'CONTENT_NOT_RELEASED', reason: 'Not released yet.', availableAt: at };
    }

    case 'RELATIVE': {
      if (typeof value.days !== 'number') return { unlocked: false, code: 'CONTENT_NOT_RELEASED', reason: 'Release schedule is not configured.' };
      const at = new Date(ctx.batchStartAt.getTime() + value.days * DAY_MS);
      return ctx.now >= at
        ? { unlocked: true }
        : { unlocked: false, code: 'CONTENT_NOT_RELEASED', reason: 'Not released yet.', availableAt: at };
    }

    case 'PREREQUISITE': {
      const req = value.requiredItemId;
      // A missing/unpublished prerequisite must never silently unlock content.
      if (!req || !ctx.publishedItemIds.has(req)) {
        return { unlocked: false, code: 'PREREQUISITE_REQUIRED', reason: 'A required lesson is unavailable.', requiredItemId: req };
      }
      return ctx.completedItemIds.has(req)
        ? { unlocked: true }
        : { unlocked: false, code: 'PREREQUISITE_REQUIRED', reason: 'Complete the previous lesson first.', requiredItemId: req };
    }

    case 'SCORE_BASED': {
      const req = value.requiredItemId;
      const min = value.minScorePercent;
      // Fail closed when misconfigured.
      if (!req || typeof min !== 'number' || !ctx.publishedItemIds.has(req)) {
        return { unlocked: false, code: 'CONTENT_LOCKED', reason: 'Unlocks after you reach the required score.', requiredItemId: req };
      }
      const best = ctx.bestScorePercentByItemId?.get(req);
      return best !== undefined && best >= min
        ? { unlocked: true }
        : { unlocked: false, code: 'CONTENT_LOCKED', reason: `Score at least ${min}% on the previous test to unlock this.`, requiredItemId: req };
    }
    // Stored today; enforced when mentor tooling ships. Locked (never open) until then.
    case 'MANUAL':
      return { unlocked: false, code: 'CONTENT_LOCKED', reason: 'Your mentor will unlock this.' };

    default:
      return { unlocked: false, code: 'CONTENT_LOCKED', reason: 'Locked.' };
  }
}

/** completed required items / total required items, as a percentage with 2 decimals. */
export function progressPercent(completedRequired: number, totalRequired: number): number {
  if (totalRequired <= 0) return 0;
  return Math.round((completedRequired / totalRequired) * 10_000) / 100;
}
