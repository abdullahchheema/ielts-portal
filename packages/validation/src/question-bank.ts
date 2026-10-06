import { z } from 'zod';

/**
 * Question bank rules shared by API and web. Fine-grained IELTS item types map onto the grader types
 * that the existing assessment engine already scores (see assessments.ts), so nothing about scoring changes.
 */
export const SKILL_KEYS = ['LISTENING', 'READING', 'WRITING', 'SPEAKING'] as const;

export const IELTS_ITEM_TYPES = {
  MCQ_SINGLE: { grader: 'MCQ_SINGLE', skills: ['LISTENING', 'READING'] },
  MCQ_MULTI: { grader: 'MCQ_MULTI', skills: ['LISTENING', 'READING'] },
  TFNG: { grader: 'TFNG', skills: ['READING'] },
  YNNG: { grader: 'YNNG', skills: ['READING'] },
  MATCHING_HEADINGS: { grader: 'MATCHING', skills: ['READING'] },
  MATCHING_INFORMATION: { grader: 'MATCHING', skills: ['READING'] },
  MATCHING_FEATURES: { grader: 'MATCHING', skills: ['READING', 'LISTENING'] },
  MAP_LABELLING: { grader: 'MATCHING', skills: ['LISTENING', 'READING'] },
  SENTENCE_COMPLETION: { grader: 'COMPLETION', skills: ['LISTENING', 'READING'] },
  SUMMARY_COMPLETION: { grader: 'COMPLETION', skills: ['READING'] },
  NOTE_COMPLETION: { grader: 'COMPLETION', skills: ['LISTENING', 'READING'] },
  TABLE_COMPLETION: { grader: 'COMPLETION', skills: ['LISTENING', 'READING'] },
  FORM_COMPLETION: { grader: 'COMPLETION', skills: ['LISTENING'] },
  WRITING_TASK1: { grader: 'NONE', skills: ['WRITING'] },
  WRITING_TASK2: { grader: 'NONE', skills: ['WRITING'] },
  SPEAKING_PART1: { grader: 'NONE', skills: ['SPEAKING'] },
  SPEAKING_PART2: { grader: 'NONE', skills: ['SPEAKING'] },
  SPEAKING_PART3: { grader: 'NONE', skills: ['SPEAKING'] },
} as const;

export type IeltsItemType = keyof typeof IELTS_ITEM_TYPES;
export const ITEM_TYPE_KEYS = Object.keys(IELTS_ITEM_TYPES) as IeltsItemType[];

export const QUESTION_SET_STATUSES = ['DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED'] as const;
export type QuestionSetStatus = (typeof QUESTION_SET_STATUSES)[number];

/** Allowed status moves. Anything else is refused, so a published set cannot silently go back to draft. */
export const QUESTION_SET_TRANSITIONS: Record<QuestionSetStatus, QuestionSetStatus[]> = {
  DRAFT: ['APPROVED', 'ARCHIVED'],
  APPROVED: ['DRAFT', 'PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['ARCHIVED'],
  ARCHIVED: [],
};

const halfBand = z.number().min(0).max(9).refine((n) => Number.isInteger(n * 2), 'Use steps of 0.5');

export const questionSetCreateSchema = z.object({
  title: z.string().trim().min(3).max(160),
  skill: z.enum(SKILL_KEYS),
  module: z.enum(['ACADEMIC', 'GENERAL', 'BOTH']).default('ACADEMIC'),
  sectionNumber: z.number().int().min(1).max(4).nullable().optional(),
  topic: z.string().trim().max(80).nullable().optional(),
  difficulty: z.number().int().min(1).max(5).default(3),
  bandTarget: halfBand.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  source: z.string().trim().max(160).nullable().optional(),
  timeEstimateMin: z.number().int().min(1).max(180).nullable().optional(),
  /** Passage text, cue card or chart description shown above the questions. */
  stimulus: z.object({
    passage: z.string().max(40_000).optional(),
    cueCard: z.string().max(4_000).optional(),
    chart: z.string().max(4_000).optional(),
  }).nullable().optional(),
});
export const questionSetUpdateSchema = questionSetCreateSchema.partial();

export const questionSetStatusSchema = z.object({
  status: z.enum(QUESTION_SET_STATUSES),
  studentFacing: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});

const option = z.object({ label: z.string().trim().min(1).max(500), isCorrect: z.boolean().default(false) });

export const bankQuestionSchema = z
  .object({
    ieltsType: z.enum(ITEM_TYPE_KEYS as [IeltsItemType, ...IeltsItemType[]]),
    prompt: z.object({ text: z.string().trim().min(1).max(5_000) }),
    marks: z.number().min(0.5).max(20).default(1),
    options: z.array(option).max(12).optional(),
    answerKey: z.object({ value: z.string().optional(), accepted: z.array(z.string().trim().min(1).max(200)).max(20).optional() }).optional(),
    timeEstimateSec: z.number().int().min(10).max(900).nullable().optional(),
  })
  .superRefine((q, ctx) => {
    const grader = IELTS_ITEM_TYPES[q.ieltsType].grader;
    if (grader === 'NONE') return;
    if (grader === 'COMPLETION' && !(q.answerKey?.accepted?.length)) ctx.addIssue({ code: 'custom', path: ['answerKey'], message: 'Add at least one accepted answer.' });
    if (grader === 'TFNG' && !['TRUE', 'FALSE', 'NOT_GIVEN'].includes(q.answerKey?.value ?? '')) ctx.addIssue({ code: 'custom', path: ['answerKey'], message: 'Choose True, False or Not Given.' });
    if (grader === 'YNNG' && !['YES', 'NO', 'NOT_GIVEN'].includes(q.answerKey?.value ?? '')) ctx.addIssue({ code: 'custom', path: ['answerKey'], message: 'Choose Yes, No or Not Given.' });
    if (grader === 'MCQ_SINGLE' || grader === 'MCQ_MULTI' || grader === 'MATCHING') {
      const correct = (q.options ?? []).filter((o) => o.isCorrect).length;
      if (q.options === undefined || q.options.length < 2) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least two options.' });
      if (grader === 'MCQ_SINGLE' && correct !== 1) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Mark exactly one correct option.' });
      if (grader !== 'MCQ_SINGLE' && correct < 1) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Mark at least one correct option.' });
    }
  });
export const bankQuestionUpdateSchema = bankQuestionSchema;

export const bankPickSchema = z.object({
  skill: z.enum(SKILL_KEYS),
  count: z.number().int().min(1).max(40),
  topic: z.string().trim().max(80).optional(),
  difficultyMin: z.number().int().min(1).max(5).optional(),
  difficultyMax: z.number().int().min(1).max(5).optional(),
  ieltsTypes: z.array(z.enum(ITEM_TYPE_KEYS as [IeltsItemType, ...IeltsItemType[]])).max(18).optional(),
});

export const copyToSectionSchema = z.object({
  questionIds: z.array(z.string().uuid()).min(1).max(60),
});

export const practiceSessionSchema = z.object({
  skill: z.enum(['LISTENING', 'READING']),
  count: z.number().int().min(5).max(40).default(10),
  topic: z.string().trim().max(80).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
});

export type QuestionSetCreateInput = z.infer<typeof questionSetCreateSchema>;
export type QuestionSetUpdateInput = z.infer<typeof questionSetUpdateSchema>;
export type QuestionSetStatusInput = z.infer<typeof questionSetStatusSchema>;
export type BankQuestionInput = z.infer<typeof bankQuestionSchema>;
export type BankPickInput = z.infer<typeof bankPickSchema>;
export type CopyToSectionInput = z.infer<typeof copyToSectionSchema>;
export type PracticeSessionInput = z.infer<typeof practiceSessionSchema>;
