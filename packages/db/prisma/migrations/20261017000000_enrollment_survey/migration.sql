-- Onboarding survey: one row per student, draft and final record. Answered behind the account + email
-- verification gate, before payment, in the enroll wizard. Not append-only -- a student may revise before
-- submitting -- so no forbid_mutation() here, unlike the lifecycle/audit tables.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS "enrollment_surveys" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id"         UUID NOT NULL UNIQUE REFERENCES "student_profiles" ("id"),
  "status"             TEXT NOT NULL DEFAULT 'DRAFT',
  "taken_before"       TEXT,
  "had_band"           TEXT,
  "prior_scores"       JSONB,
  "reason"             TEXT,
  "reason_other"       TEXT,
  "target_band"        DECIMAL(3,1),
  "test_timeline"      TEXT,
  "challenging_skills" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "proficiency"        TEXT,
  "daily_minutes"      TEXT,
  "learning_format"    TEXT,
  "help_with"          JSONB NOT NULL DEFAULT '[]'::jsonb,
  "revision"           INTEGER NOT NULL DEFAULT 1,
  "submitted_at"       TIMESTAMP(3),
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "enrollment_surveys_status_valid" CHECK ("status" IN ('DRAFT', 'SUBMITTED')),
  CONSTRAINT "enrollment_surveys_taken_before_valid" CHECK ("taken_before" IS NULL OR "taken_before" IN ('YES', 'NO')),
  CONSTRAINT "enrollment_surveys_had_band_valid" CHECK ("had_band" IS NULL OR "had_band" IN ('YES', 'NO')),
  CONSTRAINT "enrollment_surveys_reason_valid" CHECK ("reason" IS NULL OR "reason" IN ('STUDY_ABROAD', 'IMMIGRATION', 'WORK', 'CAREER_ADVANCEMENT', 'UNIVERSITY_ADMISSION', 'OTHER')),
  CONSTRAINT "enrollment_surveys_target_band_valid" CHECK ("target_band" IS NULL OR ("target_band" >= 0 AND "target_band" <= 9 AND "target_band" * 2 = FLOOR("target_band" * 2))),
  CONSTRAINT "enrollment_surveys_test_timeline_valid" CHECK ("test_timeline" IS NULL OR "test_timeline" IN ('WITHIN_1_MONTH', 'ONE_TO_THREE_MONTHS', 'THREE_TO_SIX_MONTHS', 'SIX_TO_TWELVE_MONTHS', 'NOT_SURE')),
  CONSTRAINT "enrollment_surveys_proficiency_valid" CHECK ("proficiency" IS NULL OR "proficiency" IN ('BEGINNER', 'INTERMEDIATE', 'ADVANCED')),
  CONSTRAINT "enrollment_surveys_daily_minutes_valid" CHECK ("daily_minutes" IS NULL OR "daily_minutes" IN ('LESS_30', 'THIRTY_TO_60', 'SIXTY_TO_120', 'OVER_120')),
  CONSTRAINT "enrollment_surveys_learning_format_valid" CHECK ("learning_format" IS NULL OR "learning_format" IN ('LIVE_CLASSES', 'SELF_PACED', 'HYBRID', 'ONE_ON_ONE')),
  CONSTRAINT "enrollment_surveys_revision_valid" CHECK ("revision" >= 1)
);
ALTER TABLE "enrollment_surveys" ENABLE ROW LEVEL SECURITY;
