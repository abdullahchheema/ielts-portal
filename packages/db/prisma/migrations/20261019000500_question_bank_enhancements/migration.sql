-- Phase 1 of the four-tier plan + question bank initiative: three new grader types (ORDERING,
-- NUMERICAL, MULTI_BLANK), per-question partial credit, and image attachments for questions/sets.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

-- ── Partial credit ───────────────────────────────────────────────────────────
ALTER TABLE "question_versions" ADD COLUMN IF NOT EXISTS "partial_credit" BOOLEAN NOT NULL DEFAULT false;

-- ── New grader types ──────────────────────────────────────────────────────────
ALTER TABLE "questions" DROP CONSTRAINT IF EXISTS "questions_bank_type_valid";
ALTER TABLE "questions" ADD CONSTRAINT "questions_bank_type_valid" CHECK ("question_type" IN (
  'MCQ_SINGLE', 'MCQ_MULTI', 'TFNG', 'YNNG', 'MATCHING', 'COMPLETION', 'ORDERING', 'NUMERICAL', 'MULTI_BLANK', 'NONE'));

-- The fine-grained IELTS item-type taxonomy (ielts_type) that question-bank.ts writes to. The
-- separate ielts_question_type taxonomy (curriculum module) is independent and untouched here.
ALTER TABLE "questions" DROP CONSTRAINT IF EXISTS "questions_ielts_type_valid";
ALTER TABLE "questions" ADD CONSTRAINT "questions_ielts_type_valid" CHECK ("ielts_type" IS NULL OR "ielts_type" IN (
  'MCQ_SINGLE', 'MCQ_MULTI', 'TFNG', 'YNNG', 'MATCHING_HEADINGS', 'MATCHING_INFORMATION', 'MATCHING_FEATURES',
  'MAP_LABELLING', 'SENTENCE_COMPLETION', 'SUMMARY_COMPLETION', 'NOTE_COMPLETION', 'TABLE_COMPLETION', 'FORM_COMPLETION',
  'FLOW_CHART_COMPLETION', 'SHORT_ANSWER', 'MATCHING_SENTENCE_ENDINGS', 'DIAGRAM_LABELLING', 'ORDERING_EVENTS', 'NUMERICAL_ANSWER',
  'WRITING_TASK1', 'WRITING_TASK2', 'SPEAKING_PART1', 'SPEAKING_PART2', 'SPEAKING_PART3'));

-- ── Question images ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "question_images" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "question_version_id" UUID REFERENCES "question_versions" ("id") ON DELETE CASCADE,
  "question_set_id"     UUID REFERENCES "question_sets" ("id") ON DELETE CASCADE,
  "file_key"            TEXT NOT NULL,
  "file_mime"           TEXT NOT NULL,
  "alt_text"            TEXT,
  "width"               INTEGER,
  "height"              INTEGER,
  "sequence"            INTEGER NOT NULL DEFAULT 0,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "question_images_one_parent" CHECK (("question_version_id" IS NOT NULL) <> ("question_set_id" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "question_images_version_idx" ON "question_images" ("question_version_id");
CREATE INDEX IF NOT EXISTS "question_images_set_idx" ON "question_images" ("question_set_id");
ALTER TABLE "question_images" ENABLE ROW LEVEL SECURITY;
