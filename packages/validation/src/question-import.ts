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

/**
 * Describes a section's original paper layout (a form table, a labelled diagram, a note-completion
 * paragraph, etc.) so the student sees inputs embedded exactly where the printed blank was, instead
 * of a separate question-card list. `{{N}}` inside a `text`/`table` block's content is a 1-based
 * reference to that section's `questions[N-1]` and renders as an inline input/select there. Question
 * types that aren't fill-in-the-blank (MCQ, TFNG, YNNG, ORDERING) are placed with a `questions` block
 * instead, which renders them as the existing interactive cards.
 */
export const contentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), value: z.string().trim().min(1).max(500), level: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional() }),
  z.object({ type: z.literal('text'), value: z.string().max(10_000) }),
  z.object({ type: z.literal('table'), rows: z.array(z.array(z.string().max(2_000)).min(1).max(20)).min(1).max(50) }),
  /** `index` into the section's own `images[]` (the set's QuestionImage rows for this sectionIndex, in sequence order). */
  z.object({ type: z.literal('image'), index: z.number().int().min(0).max(10), alt: z.string().max(300).optional() }),
  /** 1-based, inclusive — renders questions[from-1..to-1] as standard interactive cards. */
  z.object({ type: z.literal('questions'), from: z.number().int().min(1), to: z.number().int().min(1) }),
]);
export type ImportContentBlock = z.infer<typeof contentBlockSchema>;

const PLACEHOLDER_RE = /\{\{(\d+)\}\}/g;
function referencedQuestionNumbers(blocks: z.infer<typeof contentBlockSchema>[]): number[] {
  const nums: number[] = [];
  for (const b of blocks) {
    if (b.type === 'text') for (const m of b.value.matchAll(PLACEHOLDER_RE)) nums.push(Number(m[1]));
    if (b.type === 'table') for (const row of b.rows) for (const cell of row) for (const m of cell.matchAll(PLACEHOLDER_RE)) nums.push(Number(m[1]));
    if (b.type === 'questions') for (let n = b.from; n <= b.to; n++) nums.push(n);
  }
  return nums;
}

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
  /** A Part often has several instruction blocks, each covering a sub-range of its questions
   *  ("Questions 1-7: ... Questions 8-10: ..."), the way a real IELTS paper prints them — rather
   *  than one combined `instructions` string for the whole Part. When given, these replace
   *  `instructions` in the renderer; each group's `count` must sum to the Part's question count,
   *  in question order. Optional and backward compatible — omit for a Part with one instruction block. */
  instructionGroups: z.array(z.object({ text: z.string().trim().min(1).max(2_000), count: z.number().int().min(1).max(50) })).min(1).max(6).optional(),
  /** When present, the renderer reproduces the original paper layout (tables, labelled diagrams,
   *  note-completion paragraphs) with inputs inline via `{{N}}` placeholders, instead of the default
   *  passage-plus-question-cards layout. Optional and backward compatible. */
  contentBlocks: z.array(contentBlockSchema).max(50).optional(),
}).refine((v) => !v.instructionGroups || v.instructionGroups.reduce((n, g) => n + g.count, 0) === v.questions.length, {
  message: 'instructionGroups counts must add up to the number of questions in this section.',
  path: ['instructionGroups'],
}).refine((v) => {
  if (!v.contentBlocks) return true;
  const nums = referencedQuestionNumbers(v.contentBlocks);
  const expected = Array.from({ length: v.questions.length }, (_, i) => i + 1);
  return nums.length === expected.length && [...nums].sort((a, b) => a - b).every((n, i) => n === expected[i]);
}, {
  message: 'contentBlocks must reference every question in this section exactly once (via {{N}} or a questions block), with no gaps, duplicates, or out-of-range numbers.',
  path: ['contentBlocks'],
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
  /** commit() only (ignored by preview): every set in the batch lands student-facing immediately
   *  instead of published-but-hidden. There's no separate draft stage to approve through first. */
  publish: z.boolean().optional(),
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
