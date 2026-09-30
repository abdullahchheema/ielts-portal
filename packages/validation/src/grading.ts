import { z } from 'zod';
import { bandSchema } from './band';

export const assignmentSettingsSchema = z.object({
  skill: z.enum(['WRITING', 'SPEAKING']),
  rubricId: z.string().uuid(),
  instructions: z.string().trim().max(10_000).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  minWords: z.number().int().min(1).max(2000).nullable().optional(),
});

export const draftSchema = z.object({
  body: z.string().max(30_000),
  revision: z.number().int().min(0),
});

export const submitWritingSchema = z.object({
  body: z.string().max(30_000).optional(),
});

export const gradeSchema = z.object({
  revision: z.number().int().min(1),
  comment: z.string().trim().max(5_000).optional(),
  scores: z.array(z.object({
    criterionId: z.string().uuid(),
    score: bandSchema,
    comment: z.string().trim().max(2_000).optional(),
  })).min(1).max(10),
});

export type AssignmentSettingsInput = z.infer<typeof assignmentSettingsSchema>;
export type DraftInput = z.infer<typeof draftSchema>;
export type SubmitWritingInput = z.infer<typeof submitWritingSchema>;
export type GradeInput = z.infer<typeof gradeSchema>;
