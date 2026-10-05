import { z } from 'zod';

/**
 * Risk thresholds are configuration, not code. They live in the Setting table so an admin can
 * tune them without a deploy. Every field has a default, so the engine works before anyone saves.
 * Cross-field rules (red must be at least as strict as yellow) are enforced here, which a set of
 * independent scalar settings could not express.
 */
export const riskThresholdsSchema = z
  .object({
    attendanceYellowPercent: z.number().int().min(0).max(100).default(80),
    attendanceRedPercent: z.number().int().min(0).max(100).default(60),
    inactivityYellowDays: z.number().int().min(1).max(365).default(7),
    inactivityRedDays: z.number().int().min(1).max(365).default(14),
    overdueYellowCount: z.number().int().min(1).max(50).default(1),
    overdueRedCount: z.number().int().min(1).max(50).default(3),
    lateYellowCount: z.number().int().min(1).max(50).default(3),
    lateWindowDays: z.number().int().min(1).max(365).default(30),
    examSoonDays: z.number().int().min(1).max(365).default(60),
    examImminentDays: z.number().int().min(1).max(365).default(30),
    gapYellowBands: z.number().min(0).max(9).default(0.5),
    gapRedBands: z.number().min(0).max(9).default(1),
    noActivityYellowDays: z.number().int().min(1).max(365).default(14),
    noActivityRedDays: z.number().int().min(1).max(365).default(30),
  })
  .strict()
  .refine((t) => t.attendanceRedPercent <= t.attendanceYellowPercent, 'Red attendance must be at or below yellow.')
  .refine((t) => t.inactivityRedDays >= t.inactivityYellowDays, 'Red inactivity must be at or after yellow.')
  .refine((t) => t.overdueRedCount >= t.overdueYellowCount, 'Red overdue count must be at or above yellow.')
  .refine((t) => t.gapRedBands >= t.gapYellowBands, 'Red gap must be at or above yellow.')
  .refine((t) => t.examImminentDays <= t.examSoonDays, 'The imminent exam window must sit inside the soon window.')
  .refine((t) => t.noActivityRedDays >= t.noActivityYellowDays, 'Red no-activity must be at or after yellow.');

export type RiskThresholds = z.infer<typeof riskThresholdsSchema>;
export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = riskThresholdsSchema.parse({});

/** Teacher-facing roster flag. Deliberately separate from risk: different audience, different decision. */
export const attendanceLowPercentSchema = z.number().int().min(0).max(100);
export const DEFAULT_ATTENDANCE_LOW_PERCENT = 75;

export const DEFAULT_GRADING_TARGET_HOURS = 48;

export const ANALYTICS_SETTING_SCHEMAS = {
  'analytics.grading.target_hours': z.number().int().min(1).max(24 * 30),
  'analytics.risk.thresholds': riskThresholdsSchema,
  'analytics.band.window': z.number().int().min(1).max(10),
  'analytics.attendance.low_percent': attendanceLowPercentSchema,
} as const;

export const ANALYTICS_DEFAULTS = {
  'analytics.grading.target_hours': DEFAULT_GRADING_TARGET_HOURS,
  'analytics.risk.thresholds': DEFAULT_RISK_THRESHOLDS,
  'analytics.band.window': 3,
  'analytics.attendance.low_percent': DEFAULT_ATTENDANCE_LOW_PERCENT,
} as const;
