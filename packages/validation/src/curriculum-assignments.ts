import { z } from 'zod';

/** A teacher assigns one piece of shared content to a batch or a named student (distinct from `Assignment`, a 1:1 fixture applying to every enrolled student). */
export const curriculumAssignmentSchema = z.object({
  contentItemId: z.string().uuid(),
  batchId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  requirement: z.enum(['REQUIRED', 'RECOMMENDED']).default('REQUIRED'),
  dueAt: z.string().datetime().optional(),
  instructions: z.string().trim().max(2000).optional(),
}).refine((v) => !!v.batchId !== !!v.studentId, { message: 'Choose exactly one of batch or student.', path: ['batchId'] });
export type CurriculumAssignmentInput = z.infer<typeof curriculumAssignmentSchema>;
