import { z } from 'zod';

/** Half-band between 0 and 9. */
export const halfBand = z.number().min(0).max(9).refine((n) => Number.isInteger(n * 2), 'Use steps of 0.5');

export const WRITING_CRITERIA = ['TASK_RESPONSE', 'COHERENCE', 'LEXICAL', 'GRAMMAR'] as const;

/**
 * What the model must return for an essay. Validated before anything is stored; anything that does not
 * match is treated as a failed evaluation and retried, never shown to a student.
 */
export const writingEvaluationSchema = z.object({
  estimatedBand: halfBand,
  criteria: z.array(z.object({
    key: z.enum(WRITING_CRITERIA),
    score: halfBand,
    comment: z.string().trim().min(1).max(600),
  })).length(4),
  feedback: z.object({
    strengths: z.array(z.string().trim().min(1).max(300)).max(6),
    taskIssues: z.array(z.string().trim().min(1).max(300)).max(6),
    coherenceIssues: z.array(z.string().trim().min(1).max(300)).max(6),
    vocabularyIssues: z.array(z.object({ excerpt: z.string().max(300), suggestion: z.string().max(300) })).max(8),
    grammarIssues: z.array(z.object({ excerpt: z.string().max(300), correction: z.string().max(300), explanation: z.string().max(300) })).max(10),
    sentenceCorrections: z.array(z.object({ original: z.string().max(400), corrected: z.string().max(400) })).max(8),
    suggestions: z.array(z.string().trim().min(1).max(300)).max(6),
  }),
});

export type WritingEvaluation = z.infer<typeof writingEvaluationSchema>;

/** Deterministic stand-in for the mock provider. It depends only on the essay's measurable size and variety. */
export function mockWritingEvaluation(words: number, typeTokenRatio: number): WritingEvaluation {
  const base = Math.min(7.5, 4.5 + words / 200 + typeTokenRatio);
  const band = Math.round(base * 2) / 2;
  const clamp = (n: number) => Math.min(9, Math.max(0, Math.round(n * 2) / 2));
  return {
    estimatedBand: clamp(band),
    criteria: [
      { key: 'TASK_RESPONSE', score: clamp(band), comment: 'Mock estimate: check that every part of the question is answered.' },
      { key: 'COHERENCE', score: clamp(band - 0.5), comment: 'Mock estimate: check paragraph organisation and linking words.' },
      { key: 'LEXICAL', score: clamp(band), comment: 'Mock estimate: look for repeated words and vague vocabulary.' },
      { key: 'GRAMMAR', score: clamp(band - 0.5), comment: 'Mock estimate: check tense consistency and sentence variety.' },
    ],
    feedback: {
      strengths: ['Mock feedback: the essay is complete enough to evaluate.'],
      taskIssues: [],
      coherenceIssues: [],
      vocabularyIssues: [],
      grammarIssues: [],
      sentenceCorrections: [],
      suggestions: ['This is a development estimate, not real feedback.'],
    },
  };
}
