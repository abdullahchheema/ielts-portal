import { z } from 'zod';
import { halfBand } from '../writing/writing.schemas';

export const SPEAKING_CRITERIA = ['FLUENCY', 'LEXICAL', 'GRAMMAR', 'PRONUNCIATION'] as const;

/**
 * Speaking estimates come from a transcript. Pronunciation cannot be judged from text, so its score may be null
 * and the feedback says so. Every number is labelled "AI Estimated Score" wherever it is shown.
 */
export const speakingEvaluationSchema = z.object({
  estimatedBand: halfBand,
  criteria: z.array(z.object({
    key: z.enum(SPEAKING_CRITERIA),
    score: halfBand.nullable(),
    comment: z.string().trim().min(1).max(600),
  })).length(4),
  feedback: z.object({
    strengths: z.array(z.string().trim().min(1).max(300)).max(6),
    weaknesses: z.array(z.string().trim().min(1).max(300)).max(6),
    corrections: z.array(z.object({ original: z.string().max(300), corrected: z.string().max(300) })).max(8),
    recommendedPractice: z.array(z.string().trim().min(1).max(300)).max(6),
    pronunciationNote: z.string().max(400),
  }),
});

export type SpeakingEvaluation = z.infer<typeof speakingEvaluationSchema>;

export function mockSpeakingEvaluation(words: number): SpeakingEvaluation {
  const band = Math.min(7, Math.max(4, Math.round((4 + words / 60) * 2) / 2));
  const clamp = (n: number) => Math.min(9, Math.max(0, Math.round(n * 2) / 2));
  return {
    estimatedBand: clamp(band),
    criteria: [
      { key: 'FLUENCY', score: clamp(band), comment: 'Mock estimate based on answer length.' },
      { key: 'LEXICAL', score: clamp(band), comment: 'Mock estimate: check for varied vocabulary.' },
      { key: 'GRAMMAR', score: clamp(band - 0.5), comment: 'Mock estimate: check tense control.' },
      { key: 'PRONUNCIATION', score: null, comment: 'Cannot be judged from a transcript.' },
    ],
    feedback: {
      strengths: ['Mock feedback: the answer was recorded and transcribed.'],
      weaknesses: [],
      corrections: [],
      recommendedPractice: ['This is a development estimate, not real feedback.'],
      pronunciationNote: 'Pronunciation is not judged from a text transcript.',
    },
  };
}
