import { z } from 'zod';

export const PLAN_NAMES = ['FREE', 'STARTER', 'ADVANCED', 'PREMIUM'] as const;
export type PlanName = (typeof PLAN_NAMES)[number];

export const FEATURE_KEYS = [
  'assessment.free_test', 'assessment.detailed_results', 'ai.evaluation',
  'practice.unlimited', 'mock.unlimited', 'teacher.assignment', 'class.access', 'premium.services',
] as const;

export const updatePlanSchema = z.object({
  displayName: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  price: z.number().min(0).max(10_000_000).optional(),
  currency: z.string().trim().length(3).optional(),
  billingPeriod: z.enum(['ONE_TIME', 'MONTHLY', 'YEARLY']).optional(),
  durationDays: z.number().int().min(1).max(3650).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100).optional(),
});

export const replaceEntitlementsSchema = z.object({
  entitlements: z.array(z.object({
    featureKey: z.enum(FEATURE_KEYS),
    value: z.boolean(),
    description: z.string().trim().max(200).nullable().optional(),
  })).min(1).max(30),
});

export const assignStudentPlanSchema = z.object({
  studentId: z.string().uuid(),
  planName: z.enum(PLAN_NAMES),
  reason: z.string().trim().min(3).max(500),
});

export const changePlanSchema = z.object({
  planName: z.enum(PLAN_NAMES),
});

export const requestPremiumBookingSchema = z.object({
  serviceId: z.string().uuid(),
  notes: z.string().trim().max(1000).optional(),
});

export const decidePremiumBookingSchema = z.object({
  status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']),
  scheduledAt: z.string().datetime().optional(),
  adminNotes: z.string().trim().max(1000).optional(),
});

export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type ReplaceEntitlementsInput = z.infer<typeof replaceEntitlementsSchema>;
export type AssignStudentPlanInput = z.infer<typeof assignStudentPlanSchema>;
export type ChangePlanInput = z.infer<typeof changePlanSchema>;
export type RequestPremiumBookingInput = z.infer<typeof requestPremiumBookingSchema>;
export type DecidePremiumBookingInput = z.infer<typeof decidePremiumBookingSchema>;
