-- Student feedback and NPS. Additive. Responses are append-only, and an anonymous response never stores who sent it.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS "feedback_surveys" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "trigger"     TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "questions"   JSONB NOT NULL DEFAULT '[]',
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feedback_surveys_trigger_valid" CHECK ("trigger" IN ('ONBOARDING', 'MID_COURSE', 'MOCK_EXAM', 'COMPLETION'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "feedback_surveys_trigger_unique" ON "feedback_surveys" ("trigger");
ALTER TABLE "feedback_surveys" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "feedback_requests" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "survey_id"     UUID NOT NULL REFERENCES "feedback_surveys" ("id"),
  "student_id"    UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "batch_id"      UUID REFERENCES "batches" ("id"),
  "trigger_ref"   TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'PENDING',
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "responded_at"  TIMESTAMP(3),
  CONSTRAINT "feedback_requests_status_valid" CHECK ("status" IN ('PENDING', 'COMPLETED', 'DISMISSED', 'EXPIRED')),
  CONSTRAINT "feedback_requests_unique" UNIQUE ("survey_id", "student_id", "trigger_ref")
);
CREATE INDEX IF NOT EXISTS "feedback_requests_student_idx" ON "feedback_requests" ("student_id", "status");
ALTER TABLE "feedback_requests" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "feedback_responses" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "survey_id"        UUID NOT NULL REFERENCES "feedback_surveys" ("id"),
  "batch_id"         UUID REFERENCES "batches" ("id"),
  "trigger"          TEXT NOT NULL,
  "request_id"       UUID UNIQUE REFERENCES "feedback_requests" ("id"),
  "student_id"       UUID REFERENCES "student_profiles" ("id"),
  "anonymous"        BOOLEAN NOT NULL,
  "score"            INTEGER NOT NULL,
  "comment_overall"  TEXT,
  "comment_teacher"  TEXT,
  "comment_course"   TEXT,
  "comment_technical" TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feedback_responses_score_range" CHECK ("score" BETWEEN 0 AND 10),
  CONSTRAINT "feedback_responses_trigger_valid" CHECK ("trigger" IN ('ONBOARDING', 'MID_COURSE', 'MOCK_EXAM', 'COMPLETION')),
  CONSTRAINT "feedback_responses_anonymity" CHECK (
    ("anonymous" AND "student_id" IS NULL AND "request_id" IS NULL)
    OR (NOT "anonymous" AND "student_id" IS NOT NULL AND "request_id" IS NOT NULL)),
  CONSTRAINT "feedback_responses_comment_len" CHECK (
    COALESCE(char_length("comment_overall"), 0) <= 1000 AND COALESCE(char_length("comment_teacher"), 0) <= 1000
    AND COALESCE(char_length("comment_course"), 0) <= 1000 AND COALESCE(char_length("comment_technical"), 0) <= 1000)
);
CREATE INDEX IF NOT EXISTS "feedback_responses_created_idx" ON "feedback_responses" ("created_at");
ALTER TABLE "feedback_responses" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE TRIGGER "feedback_responses_immutable" BEFORE UPDATE OR DELETE ON "feedback_responses"
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The four default surveys. Staff can edit the wording later; the trigger mapping stays fixed.
INSERT INTO "feedback_surveys" ("trigger", "title", "questions") VALUES
  ('ONBOARDING', 'Getting started', '[{"key":"overall","label":"What would make your first weeks easier?"},{"key":"technical","label":"Any trouble using the platform?"}]'),
  ('MID_COURSE', 'Mid-course check-in', '[{"key":"overall","label":"What is working well, and what is not?"},{"key":"teacher","label":"How is your teacher helping you?"},{"key":"course","label":"What would you change about the course?"}]'),
  ('MOCK_EXAM', 'After your mock exam', '[{"key":"overall","label":"How useful was the mock exam?"},{"key":"technical","label":"Did anything go wrong during the exam?"}]'),
  ('COMPLETION', 'Course completed', '[{"key":"overall","label":"What helped you most on the course?"},{"key":"teacher","label":"How was your teacher?"},{"key":"course","label":"What would make the course better for the next student?"}]')
ON CONFLICT ("trigger") DO NOTHING;
