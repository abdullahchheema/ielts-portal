import { z } from 'zod';

// ── study plan (spec §9: when a student plans to work on something) ──
export const studyPlanItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  contentItemId: z.string().uuid().optional(),
  plannedFor: z.string().date(),
  estimatedMinutes: z.number().int().min(1).max(600).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type StudyPlanItemInput = z.infer<typeof studyPlanItemSchema>;
export const updateStudyPlanItemSchema = studyPlanItemSchema.partial().extend({
  status: z.enum(['PLANNED', 'DONE', 'SKIPPED']).optional(),
});
export type UpdateStudyPlanItemInput = z.infer<typeof updateStudyPlanItemSchema>;

// ── vocabulary bank (spec §26) ──
export const SOURCE_TYPES = ['READING', 'LESSON', 'WRITING_FEEDBACK', 'SPEAKING_FEEDBACK', 'MANUAL'] as const;
export const vocabularyEntrySchema = z.object({
  term: z.string().trim().min(1).max(100),
  definition: z.string().trim().max(1000).optional(),
  example: z.string().trim().max(1000).optional(),
  collocation: z.string().trim().max(200).optional(),
  sourceType: z.enum(SOURCE_TYPES).optional(),
  sourceId: z.string().uuid().optional(),
  studentExample: z.string().trim().max(1000).optional(),
});
export type VocabularyEntryInput = z.infer<typeof vocabularyEntrySchema>;
export const updateVocabularyEntrySchema = vocabularyEntrySchema.partial().extend({
  reviewStatus: z.enum(['NEW', 'LEARNING', 'KNOWN']).optional(),
});
export type UpdateVocabularyEntryInput = z.infer<typeof updateVocabularyEntrySchema>;

// ── curriculum assignment (spec §20: a teacher assigns a curriculum item to a batch or students) ──
export const curriculumAssignmentSchema = z.object({
  contentItemId: z.string().uuid(),
  batchId: z.string().uuid().optional(),
  studentIds: z.array(z.string().uuid()).max(500).optional(),
  requirement: z.enum(['REQUIRED', 'RECOMMENDED']).default('REQUIRED'),
  classification: z.enum(['PRE_CLASS', 'POST_CLASS', 'HOMEWORK', 'GENERAL']).default('GENERAL'),
  sessionId: z.string().uuid().optional(),
  dueAt: z.string().datetime().optional(),
  instructions: z.string().trim().max(2000).optional(),
  publish: z.boolean().default(true),
}).refine((v) => !!v.batchId || (v.studentIds && v.studentIds.length > 0), { message: 'Choose a batch or at least one student.', path: ['batchId'] });
export type CurriculumAssignmentInput = z.infer<typeof curriculumAssignmentSchema>;

// ── mock-test access (spec §22) ──
export const mockAccessRequestSchema = z.object({ reason: z.string().trim().max(500).optional() });
export type MockAccessRequestInput = z.infer<typeof mockAccessRequestSchema>;
export const mockAccessDecisionSchema = z.object({
  decisionNote: z.string().trim().max(1000).optional(),
  availableFrom: z.string().datetime().optional(),
  availableUntil: z.string().datetime().optional(),
});
export type MockAccessDecisionInput = z.infer<typeof mockAccessDecisionSchema>;
export const mockActivationSchema = z.object({
  batchId: z.string().uuid(),
  availableFrom: z.string().datetime(),
  availableUntil: z.string().datetime().optional(),
  instructions: z.string().trim().max(2000).optional(),
}).refine((v) => !v.availableUntil || new Date(v.availableUntil) > new Date(v.availableFrom), { message: 'Must be after the start.', path: ['availableUntil'] });
export type MockActivationInput = z.infer<typeof mockActivationSchema>;

// ── lecture recordings (spec §47) ──
export const lectureRecordingSchema = z.object({
  sessionId: z.string().uuid().optional(),
  batchId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  module: z.enum(['LISTENING', 'READING', 'WRITING', 'SPEAKING', 'GENERAL']).optional(),
  driveUrl: z.string().url().max(500),
  description: z.string().trim().max(2000).optional(),
  chapters: z.array(z.object({ label: z.string().trim().max(120), atSeconds: z.number().int().min(0).optional() })).max(50).optional(),
});
export type LectureRecordingInput = z.infer<typeof lectureRecordingSchema>;
export const updateLectureRecordingSchema = lectureRecordingSchema.partial();
export type UpdateLectureRecordingInput = z.infer<typeof updateLectureRecordingSchema>;
export const lectureRecordingReviewSchema = z.object({ reviewNote: z.string().trim().max(1000).optional() });
export type LectureRecordingReviewInput = z.infer<typeof lectureRecordingReviewSchema>;
