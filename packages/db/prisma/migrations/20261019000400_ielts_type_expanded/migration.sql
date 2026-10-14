-- Reconciles the IELTS item-type taxonomy with a second, independently-built list: adds the
-- standard types it was missing (Flow-chart Completion, Short-answer, Matching Sentence Endings)
-- to the existing `questions.ielts_type` CHECK rather than introducing a second, parallel enum.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

ALTER TABLE "questions" DROP CONSTRAINT IF EXISTS "questions_ielts_type_valid";
ALTER TABLE "questions" ADD CONSTRAINT "questions_ielts_type_valid" CHECK ("ielts_type" IS NULL OR "ielts_type" IN (
  'MCQ_SINGLE', 'MCQ_MULTI', 'TFNG', 'YNNG', 'MATCHING_HEADINGS', 'MATCHING_INFORMATION', 'MATCHING_FEATURES',
  'MAP_LABELLING', 'SENTENCE_COMPLETION', 'SUMMARY_COMPLETION', 'NOTE_COMPLETION', 'TABLE_COMPLETION', 'FORM_COMPLETION',
  'FLOW_CHART_COMPLETION', 'SHORT_ANSWER', 'MATCHING_SENTENCE_ENDINGS',
  'WRITING_TASK1', 'WRITING_TASK2', 'SPEAKING_PART1', 'SPEAKING_PART2', 'SPEAKING_PART3'));
