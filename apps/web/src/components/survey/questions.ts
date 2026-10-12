import { SURVEY_DAILY_MINUTES, SURVEY_HELP, SURVEY_LEARNING_FORMATS, SURVEY_PROFICIENCY, SURVEY_REASONS, SURVEY_SKILLS, SURVEY_TIMELINES } from '@ielts/validation';

/** Static copy for the 10 onboarding-survey slides. Answer shape/validity is owned by @ielts/validation; this is display only. */

export const REASON_LABEL: Record<(typeof SURVEY_REASONS)[number], string> = {
  STUDY_ABROAD: 'Studying abroad', IMMIGRATION: 'Immigration', WORK: 'Work', CAREER_ADVANCEMENT: 'Career advancement',
  UNIVERSITY_ADMISSION: 'University admission', OTHER: 'Other',
};

export const TIMELINE_LABEL: Record<(typeof SURVEY_TIMELINES)[number], string> = {
  WITHIN_1_MONTH: 'Within a month', ONE_TO_THREE_MONTHS: '1–3 months', THREE_TO_SIX_MONTHS: '3–6 months',
  SIX_TO_TWELVE_MONTHS: '6–12 months', NOT_SURE: 'Not sure yet',
};

export const SKILL_LABEL: Record<(typeof SURVEY_SKILLS)[number], string> = {
  LISTENING: 'Listening', READING: 'Reading', WRITING: 'Writing', SPEAKING: 'Speaking',
};

export const PROFICIENCY_LABEL: Record<(typeof SURVEY_PROFICIENCY)[number], string> = {
  BEGINNER: 'Beginner', INTERMEDIATE: 'Intermediate', ADVANCED: 'Advanced',
};

export const DAILY_MINUTES_LABEL: Record<(typeof SURVEY_DAILY_MINUTES)[number], string> = {
  LESS_30: 'Less than 30 minutes', THIRTY_TO_60: '30–60 minutes', SIXTY_TO_120: '1–2 hours', OVER_120: 'Over 2 hours',
};

export const LEARNING_FORMAT_LABEL: Record<(typeof SURVEY_LEARNING_FORMATS)[number], string> = {
  LIVE_CLASSES: 'Live classes', SELF_PACED: 'Self-paced', HYBRID: 'A mix of both', ONE_ON_ONE: 'One-on-one',
};

export const HELP_LABEL: Record<(typeof SURVEY_HELP)[number], string> = {
  WRITING_FEEDBACK: 'Writing feedback', SPEAKING_PRACTICE: 'Speaking practice', MOCK_TESTS: 'Mock tests',
  STUDY_PLAN: 'A study plan', VOCABULARY: 'Vocabulary building', TIME_MANAGEMENT: 'Time management', MOTIVATION: 'Staying motivated',
};

export const SURVEY_SLIDE_COUNT = 10;
