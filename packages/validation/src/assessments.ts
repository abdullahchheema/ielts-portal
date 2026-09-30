import { z } from 'zod';

export const ASSESSMENT_TYPES = ['PRACTICE', 'QUIZ', 'LISTENING', 'READING', 'MOCK', 'DIAGNOSTIC', 'FINAL'] as const;
export const SKILLS = ['LISTENING', 'READING', 'WRITING', 'SPEAKING'] as const;

/** Question types the auto-grader understands. Adding a type = add it here + a grader in the API's grading.ts. */
export const QUESTION_TYPES = ['MCQ_SINGLE', 'MCQ_MULTI', 'TFNG', 'YNNG', 'MATCHING', 'COMPLETION'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const createAssessmentSchema = z.object({
  title: z.string().trim().min(2).max(160),
  type: z.enum(ASSESSMENT_TYPES),
  skill: z.enum(SKILLS).optional(),
  maxAttempts: z.number().int().min(1).max(100).optional(),
  timeLimitMin: z.number().int().min(1).max(300).optional(),
  passPercent: z.number().int().min(0).max(100).default(0),
  showAnswers: z.boolean().default(true),
});
export const updateAssessmentSchema = createAssessmentSchema.partial().extend({
  maxAttempts: z.number().int().min(1).max(100).nullable().optional(),
  timeLimitMin: z.number().int().min(1).max(300).nullable().optional(),
});

export const assessmentSectionSchema = z.object({
  title: z.string().trim().min(1).max(160),
  content: z.object({
    passage: z.string().max(50_000).optional(),
    instructions: z.string().max(5_000).optional(),
  }).optional(),
});
export const updateAssessmentSectionSchema = assessmentSectionSchema.partial().extend({ sequence: z.number().int().min(0).optional() });

const option = z.object({ label: z.string().trim().min(1).max(500), isCorrect: z.boolean().default(false) });

export const questionSchema = z.object({
  type: z.enum(QUESTION_TYPES),
  prompt: z.object({ text: z.string().trim().min(1).max(5_000) }),
  marks: z.number().min(0.5).max(20).default(1),
  options: z.array(option).max(12).optional(),
  /** TFNG/YNNG: { value }, COMPLETION: { accepted: [...] } */
  answerKey: z.object({ value: z.string().optional(), accepted: z.array(z.string().trim().min(1).max(200)).max(20).optional() }).optional(),
});
export const updateQuestionSchema = questionSchema.partial();

export const saveAnswersSchema = z.object({
  revision: z.number().int().min(0),
  answers: z.array(z.object({ questionVersionId: z.string().uuid(), answer: z.unknown() })).max(300),
});

export const bandTableSchema = z.object({
  testType: z.enum(['LISTENING', 'READING_ACADEMIC', 'READING_GENERAL']),
  rows: z.array(z.object({ rawMin: z.number().int().min(0).max(40), rawMax: z.number().int().min(0).max(40), band: z.number().min(0).max(9).refine((n) => Number.isInteger(n * 2), 'Steps of 0.5') })).min(1).max(41),
});

export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>;
export type UpdateAssessmentInput = z.infer<typeof updateAssessmentSchema>;
export type AssessmentSectionInput = z.infer<typeof assessmentSectionSchema>;
export type UpdateAssessmentSectionInput = z.infer<typeof updateAssessmentSectionSchema>;
export type QuestionInput = z.infer<typeof questionSchema>;
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;
export type SaveAnswersInput = z.infer<typeof saveAnswersSchema>;
export type BandTableInput = z.infer<typeof bandTableSchema>;
