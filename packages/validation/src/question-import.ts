import { z } from 'zod';
import { ITEM_TYPE_KEYS, IeltsItemType, SKILL_KEYS } from './question-bank';

/**
 * Bulk question import format. Options never carry ids here (unlike the direct authoring API) —
 * ORDERING's `correctOrder` and MATCHING's option-based fallback reference options by their
 * `label` instead, since that's what a human-authored import file can practically contain. The
 * import service translates labels to generated option ids before handing off to the existing
 * QuestionBankService.addQuestion(), which is exactly what a hand-authored request would send.
 */

const importOption = z.object({ label: z.string().trim().min(1).max(500), isCorrect: z.boolean().default(false) });

export const importQuestionSchema = z.object({
  ieltsType: z.enum(ITEM_TYPE_KEYS as [IeltsItemType, ...IeltsItemType[]]),
  prompt: z.object({ text: z.string().trim().min(1).max(5_000) }),
  marks: z.number().min(0.5).max(20).default(1),
  options: z.array(importOption).max(12).optional(),
  answerKey: z.object({
    value: z.string().optional(),
    accepted: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    /** ORDERING only: a permutation of the option labels above, in correct order. */
    correctOrder: z.array(z.string()).max(20).optional(),
    numericValue: z.number().optional(),
    tolerance: z.number().min(0).optional(),
    blanks: z.array(z.object({ key: z.string().trim().min(1).max(40), accepted: z.array(z.string().trim().min(1).max(200)).min(1).max(20) })).max(20).optional(),
    mappings: z.array(z.object({ left: z.string().trim().min(1).max(200), right: z.string().trim().min(1).max(200) })).max(20).optional(),
  }).optional(),
  partialCredit: z.boolean().optional(),
  timeEstimateSec: z.number().int().min(10).max(900).nullable().optional(),
});

/** One passage/section of a multi-passage module (e.g. one Reading passage, one Listening section),
 *  each with its own instructions and its own questions — a module made of several of these renders
 *  the way a real IELTS paper does: passage, then that passage's questions, then the next passage. */
export const importSectionSchema = z.object({
  title: z.string().trim().min(1).max(160),
  instructions: z.string().max(5_000).optional(),
  passage: z.string().max(40_000).optional(),
  cueCard: z.string().max(4_000).optional(),
  questions: z.array(importQuestionSchema).min(1).max(100),
});

export const importSetSchema = z.object({
  title: z.string().trim().min(3).max(160),
  skill: z.enum(SKILL_KEYS),
  module: z.enum(['ACADEMIC', 'GENERAL', 'BOTH']).default('ACADEMIC'),
  topic: z.string().trim().max(80).nullable().optional(),
  difficulty: z.number().int().min(1).max(5).default(3),
  source: z.string().trim().max(160).nullable().optional(),
  /** Single-passage (or passage-less) sets — Writing/Speaking prompts, or a short Reading/Listening
   *  module with just one passage. Mutually exclusive with `sections` below. */
  stimulus: z.object({
    passage: z.string().max(40_000).optional(),
    cueCard: z.string().max(4_000).optional(),
    chart: z.string().max(4_000).optional(),
  }).nullable().optional(),
  questions: z.array(importQuestionSchema).min(1).max(100).optional(),
  /** Multi-passage modules — a full Reading/Listening paper. Mutually exclusive with `stimulus`/`questions`. */
  sections: z.array(importSectionSchema).min(1).max(6).optional(),
}).refine((v) => (v.sections ? !v.questions : !!v.questions?.length), {
  message: 'Provide either "questions" (one passage) or "sections" (several passages), not both.',
  path: ['questions'],
});

export const bulkImportSchema = z.object({
  sets: z.array(importSetSchema).min(1).max(50),
});

export type ImportQuestionInput = z.infer<typeof importQuestionSchema>;
export type ImportSectionInput = z.infer<typeof importSectionSchema>;
export type ImportSetInput = z.infer<typeof importSetSchema>;
export type BulkImportInput = z.infer<typeof bulkImportSchema>;

/** Every question in a set, in order, with the index of the section it belongs to (null for a
 *  single-passage set) — the one place both preview() and commit() get a flat, consistent list. */
export function flattenSetQuestions(set: ImportSetInput): { question: ImportQuestionInput; sectionIndex: number | null }[] {
  if (set.sections) return set.sections.flatMap((s, i) => s.questions.map((question) => ({ question, sectionIndex: i })));
  return (set.questions ?? []).map((question) => ({ question, sectionIndex: null }));
}

export interface ImportQuestionIssue { questionIndex: number; path: string; message: string }
export interface ImportSetPreview {
  setIndex: number; title: string; questionCount: number; issues: ImportQuestionIssue[];
  duplicates: { questionIndex: number; matchedQuestionId: string; matchedPrompt: string }[];
}
export interface ImportPreviewResult { sets: ImportSetPreview[]; totalQuestions: number; totalIssues: number; totalDuplicates: number }
export interface ImportCommitResult { created: { setId: string; title: string; questionCount: number }[] }
