-- Assessment foundations: writing and speaking practice with AI evaluation, and the full simulator.
-- Additive. Evaluations are append-only: an AI estimate is never overwritten, and a teacher's grade never changes.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

-- ── Writing ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "writing_responses" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id"      UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "question_id"     UUID REFERENCES "questions" ("id"),
  "task_type"       TEXT NOT NULL,
  "prompt_text"     TEXT NOT NULL,
  "body"            TEXT NOT NULL DEFAULT '',
  "word_count"      INTEGER NOT NULL DEFAULT 0,
  "status"          TEXT NOT NULL DEFAULT 'DRAFT',
  "revision"        INTEGER NOT NULL DEFAULT 1,
  "submitted_at"    TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "writing_responses_task_valid" CHECK ("task_type" IN ('TASK1', 'TASK2')),
  CONSTRAINT "writing_responses_status_valid" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'EVALUATED', 'FAILED')),
  CONSTRAINT "writing_responses_counts_valid" CHECK ("word_count" >= 0 AND "revision" >= 1),
  CONSTRAINT "writing_responses_body_size" CHECK (char_length("body") <= 20000),
  CONSTRAINT "writing_responses_prompt_size" CHECK (char_length("prompt_text") <= 5000)
);
CREATE INDEX IF NOT EXISTS "writing_responses_student_created_idx" ON "writing_responses" ("student_id", "created_at");
ALTER TABLE "writing_responses" ENABLE ROW LEVEL SECURITY;

-- Every saved revision of an essay. Append-only, so history can be shown and compared later.
CREATE TABLE IF NOT EXISTS "writing_revisions" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "response_id" UUID NOT NULL REFERENCES "writing_responses" ("id"),
  "revision"    INTEGER NOT NULL,
  "body"        TEXT NOT NULL,
  "word_count"  INTEGER NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "writing_revisions_unique" UNIQUE ("response_id", "revision")
);
ALTER TABLE "writing_revisions" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE TRIGGER "writing_revisions_immutable" BEFORE UPDATE OR DELETE ON "writing_revisions"
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AI or teacher-assisted analysis of one essay. Exactly one target. Never edited.
CREATE TABLE IF NOT EXISTS "writing_evaluations" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "response_id"    UUID REFERENCES "writing_responses" ("id"),
  "submission_id"  UUID REFERENCES "submissions" ("id"),
  "revision"       INTEGER NOT NULL,
  "provider"       TEXT NOT NULL,
  "model"          TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "estimated_band" DECIMAL(3,1),
  "criteria"       JSONB NOT NULL,
  "feedback"       JSONB NOT NULL,
  "stats"          JSONB NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "writing_evaluations_one_target" CHECK (("response_id" IS NULL) <> ("submission_id" IS NULL)),
  CONSTRAINT "writing_evaluations_band_valid" CHECK ("estimated_band" IS NULL OR ("estimated_band" BETWEEN 0 AND 9 AND "estimated_band" * 2 = floor("estimated_band" * 2)))
);
CREATE INDEX IF NOT EXISTS "writing_evaluations_response_idx" ON "writing_evaluations" ("response_id", "created_at");
CREATE INDEX IF NOT EXISTS "writing_evaluations_submission_idx" ON "writing_evaluations" ("submission_id", "created_at");
ALTER TABLE "writing_evaluations" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE TRIGGER "writing_evaluations_immutable" BEFORE UPDATE OR DELETE ON "writing_evaluations"
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Speaking ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "speaking_attempts" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id"  UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "mode"        TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "speaking_attempts_mode_valid" CHECK ("mode" IN ('PART1', 'PART2', 'PART3', 'FULL')),
  CONSTRAINT "speaking_attempts_status_valid" CHECK ("status" IN ('IN_PROGRESS', 'COMPLETED'))
);
CREATE INDEX IF NOT EXISTS "speaking_attempts_student_idx" ON "speaking_attempts" ("student_id", "created_at");
ALTER TABLE "speaking_attempts" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "speaking_responses" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "attempt_id"         UUID NOT NULL REFERENCES "speaking_attempts" ("id"),
  "student_id"         UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "question_id"        UUID REFERENCES "questions" ("id"),
  "part"               TEXT NOT NULL,
  "prompt_text"        TEXT NOT NULL,
  "storage_key"        TEXT UNIQUE,
  "mime"               TEXT,
  "size_bytes"         BIGINT,
  "duration_sec"       DECIMAL(8,2),
  "sha256"             TEXT,
  "status"             TEXT NOT NULL DEFAULT 'UPLOADING',
  "transcript_status"  TEXT NOT NULL DEFAULT 'PENDING',
  "transcript"         TEXT,
  "metrics"            JSONB,
  "last_error"         TEXT,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "speaking_responses_part_valid" CHECK ("part" IN ('PART1', 'PART2', 'PART3')),
  CONSTRAINT "speaking_responses_status_valid" CHECK ("status" IN ('UPLOADING', 'UPLOADED', 'PROCESSING', 'EVALUATED', 'PROCESSING_FAILED')),
  CONSTRAINT "speaking_responses_transcript_valid" CHECK ("transcript_status" IN ('PENDING', 'DONE', 'FAILED', 'UNAVAILABLE')),
  CONSTRAINT "speaking_responses_size_valid" CHECK ("size_bytes" IS NULL OR ("size_bytes" > 0 AND "size_bytes" <= 26214400))
);
CREATE INDEX IF NOT EXISTS "speaking_responses_attempt_idx" ON "speaking_responses" ("attempt_id");
CREATE INDEX IF NOT EXISTS "speaking_responses_student_idx" ON "speaking_responses" ("student_id", "created_at");
ALTER TABLE "speaking_responses" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "speaking_evaluations" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "response_id"    UUID REFERENCES "speaking_responses" ("id"),
  "submission_id"  UUID REFERENCES "submissions" ("id"),
  "provider"       TEXT NOT NULL,
  "model"          TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "estimated_band" DECIMAL(3,1),
  "criteria"       JSONB NOT NULL,
  "feedback"       JSONB NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "speaking_evaluations_one_target" CHECK (("response_id" IS NULL) <> ("submission_id" IS NULL)),
  CONSTRAINT "speaking_evaluations_band_valid" CHECK ("estimated_band" IS NULL OR ("estimated_band" BETWEEN 0 AND 9 AND "estimated_band" * 2 = floor("estimated_band" * 2)))
);
CREATE INDEX IF NOT EXISTS "speaking_evaluations_response_idx" ON "speaking_evaluations" ("response_id", "created_at");
ALTER TABLE "speaking_evaluations" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE TRIGGER "speaking_evaluations_immutable" BEFORE UPDATE OR DELETE ON "speaking_evaluations"
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Simulator ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exam_attempts" (
  "id"                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id"             UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "status"                 TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  "stage"                  TEXT NOT NULL DEFAULT 'LISTENING',
  "include_speaking"       BOOLEAN NOT NULL DEFAULT TRUE,
  "listening_assessment_id" UUID REFERENCES "assessments" ("id"),
  "reading_assessment_id"  UUID REFERENCES "assessments" ("id"),
  "listening_attempt_id"   UUID REFERENCES "assessment_attempts" ("id"),
  "reading_attempt_id"     UUID REFERENCES "assessment_attempts" ("id"),
  "writing_response_id"    UUID REFERENCES "writing_responses" ("id"),
  "speaking_attempt_id"    UUID REFERENCES "speaking_attempts" ("id"),
  "stage_deadline_at"      TIMESTAMP(3),
  "stage_revision"         INTEGER NOT NULL DEFAULT 0,
  "overall_estimate"       DECIMAL(3,1),
  "missing_skills"         TEXT[] NOT NULL DEFAULT '{}',
  "started_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at"           TIMESTAMP(3),
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exam_attempts_status_valid" CHECK ("status" IN ('IN_PROGRESS', 'COMPLETED', 'ABANDONED')),
  CONSTRAINT "exam_attempts_stage_valid" CHECK ("stage" IN ('LISTENING', 'READING', 'WRITING', 'SPEAKING', 'DONE')),
  CONSTRAINT "exam_attempts_overall_valid" CHECK ("overall_estimate" IS NULL OR ("overall_estimate" BETWEEN 0 AND 9 AND "overall_estimate" * 2 = floor("overall_estimate" * 2)))
);
-- One open simulator per student at a time.
CREATE UNIQUE INDEX IF NOT EXISTS "exam_attempts_one_open" ON "exam_attempts" ("student_id") WHERE "status" = 'IN_PROGRESS';
CREATE INDEX IF NOT EXISTS "exam_attempts_student_created_idx" ON "exam_attempts" ("student_id", "created_at");
ALTER TABLE "exam_attempts" ENABLE ROW LEVEL SECURITY;

-- ── Assessment library access: a published mock can be taken by any student with an active enrolment ──
-- (library_visible already exists from migration 20261007000000.)
