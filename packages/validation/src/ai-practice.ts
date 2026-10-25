import { z } from 'zod';

/** Writing practice, speaking practice, the full simulator and mock composition. */

export const WRITING_TASKS = ['TASK1', 'TASK2'] as const;
export const SPEAKING_PARTS = ['PART1', 'PART2', 'PART3'] as const;

/** Audio types the speaking recorder may produce or the learner may upload. Checked again by content sniffing on the server. */
export const AUDIO_MIME_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav'] as const;
export const MAX_SPEAKING_BYTES = 25 * 1024 * 1024;
export const MAX_ESSAY_CHARS = 20_000;

export const createWritingSchema = z.object({
  taskType: z.enum(WRITING_TASKS),
  questionId: z.string().uuid().optional(),
  promptText: z.string().trim().min(10).max(5000).optional(),
}).refine((v) => v.questionId || v.promptText, 'Choose a task or paste the question.');

export const saveWritingSchema = z.object({
  revision: z.number().int().min(1),
  body: z.string().max(MAX_ESSAY_CHARS),
});

export const createSpeakingAttemptSchema = z.object({
  mode: z.enum(['PART1', 'PART2', 'PART3', 'FULL']),
});

export const addSpeakingResponseSchema = z.object({
  part: z.enum(SPEAKING_PARTS),
  questionId: z.string().uuid().optional(),
  promptText: z.string().trim().min(3).max(1000).optional(),
}).refine((v) => v.questionId || v.promptText, 'Provide the question.');

export const presignSpeakingSchema = z.object({
  mime: z.enum(AUDIO_MIME_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_SPEAKING_BYTES),
});

export const completeSpeakingSchema = z.object({
  durationSec: z.number().min(0.5).max(900).optional(),
});

export const simulatorStartSchema = z.object({
  listeningAssessmentId: z.string().uuid(),
  readingAssessmentId: z.string().uuid(),
  includeSpeaking: z.boolean().default(true),
});

/** The new whole-module MockExam shape (Phase 6): one bundle id instead of picking Listening and
 *  Reading independently. */
export const simulatorStartFromMockExamSchema = z.object({
  mockExamId: z.string().uuid(),
  includeSpeaking: z.boolean().default(true),
});

export const simulatorAdvanceSchema = z.object({
  /** The stage the client believes is current. A stale request is refused rather than applied twice. */
  expectedRevision: z.number().int().min(0),
});

// Composition defaults to automatic rotation (RotationService picks the least-used published module
// per skill) — the admin supplies only a title.  Each skill can be independently pinned or left on
// auto; L/R pin a whole QuestionSet (resolved to its wrapper Assessment); W/S pin a single Question.
export const composeMockSchema = z.object({
  title: z.string().trim().min(3).max(160),
  // Listening / Reading — pin a QuestionSet or auto-rotate.
  listeningSetId: z.string().uuid().optional(),
  readingSetId:   z.string().uuid().optional(),
  // Writing / Speaking — pin specific Questions or auto-pick per attempt.
  writingTask1QuestionId:  z.string().uuid().optional(),
  writingTask2QuestionId:  z.string().uuid().optional(),
  speakingPart1QuestionId: z.string().uuid().optional(),
  speakingPart2QuestionId: z.string().uuid().optional(),
  speakingPart3QuestionId: z.string().uuid().optional(),
}).refine((v) => !!v.listeningSetId === !!v.readingSetId, 'Choose both Listening and Reading modules manually, or leave both on auto-pick.');

export const libraryVisibilitySchema = z.object({
  visible: z.boolean(),
});

export type CreateWritingInput = z.infer<typeof createWritingSchema>;
export type SaveWritingInput = z.infer<typeof saveWritingSchema>;
export type CreateSpeakingAttemptInput = z.infer<typeof createSpeakingAttemptSchema>;
export type AddSpeakingResponseInput = z.infer<typeof addSpeakingResponseSchema>;
export type PresignSpeakingInput = z.infer<typeof presignSpeakingSchema>;
export type SimulatorStartInput = z.infer<typeof simulatorStartSchema>;
export type SimulatorStartFromMockExamInput = z.infer<typeof simulatorStartFromMockExamSchema>;
export type ComposeMockInput = z.infer<typeof composeMockSchema>;
