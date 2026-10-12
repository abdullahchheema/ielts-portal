import { z } from 'zod';
import { bandSchema } from './band';

/**
 * The 10 onboarding-survey questions, as the single source of truth shared by the API and the web wizard.
 * Draft saves accept any subset (all-optional); submit requires Q1-Q10, with Q2's band reveal and Q3's
 * "Other" text conditional on the answer they follow.
 */

export const SURVEY_REASONS = ['STUDY_ABROAD', 'IMMIGRATION', 'WORK', 'CAREER_ADVANCEMENT', 'UNIVERSITY_ADMISSION', 'OTHER'] as const;
export const SURVEY_TIMELINES = ['WITHIN_1_MONTH', 'ONE_TO_THREE_MONTHS', 'THREE_TO_SIX_MONTHS', 'SIX_TO_TWELVE_MONTHS', 'NOT_SURE'] as const;
export const SURVEY_SKILLS = ['LISTENING', 'READING', 'WRITING', 'SPEAKING'] as const;
export const SURVEY_PROFICIENCY = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export const SURVEY_DAILY_MINUTES = ['LESS_30', 'THIRTY_TO_60', 'SIXTY_TO_120', 'OVER_120'] as const;
export const SURVEY_LEARNING_FORMATS = ['LIVE_CLASSES', 'SELF_PACED', 'HYBRID', 'ONE_ON_ONE'] as const;
export const SURVEY_HELP = ['WRITING_FEEDBACK', 'SPEAKING_PRACTICE', 'MOCK_TESTS', 'STUDY_PLAN', 'VOCABULARY', 'TIME_MANAGEMENT', 'MOTIVATION'] as const;

const priorScoresSchema = z.object({
  overall: bandSchema.optional(),
  listening: bandSchema.optional(),
  reading: bandSchema.optional(),
  writing: bandSchema.optional(),
  speaking: bandSchema.optional(),
});

/** All-optional: a draft can be saved one answer at a time. */
export const surveyDraftSchema = z.object({
  takenBefore: z.enum(['YES', 'NO']).optional(),
  hadBand: z.enum(['YES', 'NO']).optional(),
  priorScores: priorScoresSchema.optional(),
  reason: z.enum(SURVEY_REASONS).optional(),
  reasonOther: z.string().trim().max(200).optional(),
  targetBand: bandSchema.optional(),
  testTimeline: z.enum(SURVEY_TIMELINES).optional(),
  challengingSkills: z.array(z.enum(SURVEY_SKILLS)).max(4).optional(),
  proficiency: z.enum(SURVEY_PROFICIENCY).optional(),
  dailyMinutes: z.enum(SURVEY_DAILY_MINUTES).optional(),
  learningFormat: z.enum(SURVEY_LEARNING_FORMATS).optional(),
  helpWith: z.array(z.enum(SURVEY_HELP)).max(SURVEY_HELP.length).optional(),
});

/** Submit requires every question answered, with Q2/Q3's conditional follow-ups enforced. */
export const surveySubmitSchema = z
  .object({
    takenBefore: z.enum(['YES', 'NO'], { errorMap: () => ({ message: 'Tell us whether you have taken IELTS before' }) }),
    hadBand: z.enum(['YES', 'NO']).optional(),
    priorScores: priorScoresSchema.optional(),
    reason: z.enum(SURVEY_REASONS, { errorMap: () => ({ message: 'Tell us why you are taking IELTS' }) }),
    reasonOther: z.string().trim().max(200).optional(),
    targetBand: bandSchema,
    testTimeline: z.enum(SURVEY_TIMELINES, { errorMap: () => ({ message: 'Tell us when you plan to take the test' }) }),
    challengingSkills: z.array(z.enum(SURVEY_SKILLS)).min(1, 'Choose at least one skill').max(4),
    proficiency: z.enum(SURVEY_PROFICIENCY, { errorMap: () => ({ message: 'Choose your English proficiency' }) }),
    dailyMinutes: z.enum(SURVEY_DAILY_MINUTES, { errorMap: () => ({ message: 'Tell us how much time you can study daily' }) }),
    learningFormat: z.enum(SURVEY_LEARNING_FORMATS, { errorMap: () => ({ message: 'Choose your preferred learning format' }) }),
    helpWith: z.array(z.enum(SURVEY_HELP)).min(1, 'Choose at least one').max(SURVEY_HELP.length),
  })
  .refine((v) => v.takenBefore !== 'YES' || v.hadBand !== undefined, { message: 'Tell us whether you remember your band', path: ['hadBand'] })
  .refine((v) => v.hadBand !== 'YES' || v.priorScores?.overall !== undefined, { message: 'Enter your overall band', path: ['priorScores'] })
  .refine((v) => v.reason !== 'OTHER' || !!v.reasonOther, { message: 'Tell us your reason', path: ['reasonOther'] });

export type SurveyDraftInput = z.infer<typeof surveyDraftSchema>;
export type SurveySubmitInput = z.infer<typeof surveySubmitSchema>;
