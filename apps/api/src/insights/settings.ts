import { z } from 'zod';
import { DEFAULT_READINESS_WEIGHTS } from './readiness';
import { DEFAULT_WEAKNESS_THRESHOLDS } from './weakness';

/** Insight thresholds and weights. Stored as settings so they can be tuned without a deploy, and every change is audited. */
export const INSIGHT_SETTING_SCHEMAS = {
  'insights.weakness.thresholds': z.object({
    highRiskBelow: z.number().min(0).max(1),
    needsPracticeBelow: z.number().min(0).max(1),
    minSample: z.number().int().min(1).max(200),
  }).refine((t) => t.highRiskBelow <= t.needsPracticeBelow, 'High risk must be below needs practice.'),
  'insights.readiness.weights': z.object({
    scores: z.number().min(0).max(1), mocks: z.number().min(0).max(1), consistency: z.number().min(0).max(1), completion: z.number().min(0).max(1),
    attendance: z.number().min(0).max(1), assignments: z.number().min(0).max(1), balance: z.number().min(0).max(1), trend: z.number().min(0).max(1),
  }),
  'study_plan.minutes_per_day': z.number().int().min(15).max(300),
} as const;

export const INSIGHT_DEFAULTS = {
  'insights.weakness.thresholds': DEFAULT_WEAKNESS_THRESHOLDS,
  'insights.readiness.weights': DEFAULT_READINESS_WEIGHTS,
  'study_plan.minutes_per_day': 60,
} as const;
