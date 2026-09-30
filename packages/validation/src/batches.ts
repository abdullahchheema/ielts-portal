import { z } from 'zod';
import { emailSchema, passwordSchema } from './index-base';

const isoDate = z.string().datetime({ offset: true });

export const BATCH_STATUSES = ['DRAFT', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ARCHIVED'] as const;
export const MENTOR_ROLES = ['MAIN', 'WRITING', 'SPEAKING'] as const;

export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

export const createBatchSchema = z.object({
  courseVersionId: z.string().uuid().optional(), // defaults to the course's newest published version
  name: z.string().trim().min(2).max(120),
  startAt: isoDate,
  endAt: isoDate.optional(),
  timezone: z.string().min(2).max(60).default('Asia/Karachi'),
  description: z.string().trim().max(2000).optional(),
  days: z.array(z.enum(WEEKDAYS)).max(7).default([]),
  classTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use HH:MM (24-hour)').optional(),
  /** Optional: a batch can be created — and can take applications — before any teacher is assigned. */
  mentors: z.array(z.object({ mentorId: z.string().uuid(), mentorRole: z.enum(['MAIN', 'WRITING', 'SPEAKING']).default('MAIN') })).max(10).optional(),
  deliveryMode: z.enum(['ONLINE', 'ONSITE', 'HYBRID']).default('ONLINE'),
  enrollmentOpenAt: isoDate.optional(),
  enrollmentCloseAt: isoDate.optional(),
});

export const updateBatchSchema = createBatchSchema
  .omit({ mentors: true })
  .partial()
  .extend({ status: z.enum(BATCH_STATUSES).optional() });

export const assignMentorSchema = z.object({
  mentorId: z.string().uuid(),
  mentorRole: z.enum(MENTOR_ROLES).default('MAIN'),
});

export const createMentorSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(2).max(100),
  bio: z.string().max(2000).optional(),
  specializations: z.array(z.string().max(40)).max(10).default([]),
  // Optional: if omitted a random password is set and the mentor is emailed a reset link.
  password: passwordSchema.optional(),
});

export type CreateBatchInput = z.infer<typeof createBatchSchema>;
export type UpdateBatchInput = z.infer<typeof updateBatchSchema>;
export type AssignMentorInput = z.infer<typeof assignMentorSchema>;
export type CreateMentorInput = z.infer<typeof createMentorSchema>;
