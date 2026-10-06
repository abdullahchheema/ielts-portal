-- Student intelligence: cached insights, study plans, vocabulary with spaced review, grammar tracking.
-- Additive. Snapshots are caches: the raw records stay authoritative and every snapshot can be recalculated.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

-- ── Cached calculations (weakness, readiness, target band summaries) ─────────
CREATE TABLE IF NOT EXISTS "student_snapshots" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id"   UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "kind"         TEXT NOT NULL,
  "period_key"   TEXT NOT NULL DEFAULT 'current',
  "payload"      JSONB NOT NULL,
  "inputs_hash"  TEXT NOT NULL,
  "computed_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_snapshots_unique" UNIQUE ("student_id", "kind", "period_key")
);
ALTER TABLE "student_snapshots" ENABLE ROW LEVEL SECURITY;

-- ── Study plans: plan → weeks → days → tasks ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "study_plans" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id"     UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "status"         TEXT NOT NULL DEFAULT 'ACTIVE',
  "plan_status"    TEXT NOT NULL,
  "summary"        TEXT NOT NULL,
  "inputs_hash"    TEXT NOT NULL,
  "minutes_per_day" INTEGER NOT NULL,
  "generated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "superseded_at"  TIMESTAMP(3),
  CONSTRAINT "study_plans_status_valid" CHECK ("status" IN ('ACTIVE', 'SUPERSEDED')),
  CONSTRAINT "study_plans_plan_status_valid" CHECK ("plan_status" IN ('ON_TRACK', 'NEEDS_IMPROVEMENT', 'NO_TARGET', 'NO_EXAM_DATE')),
  CONSTRAINT "study_plans_minutes_valid" CHECK ("minutes_per_day" BETWEEN 15 AND 300)
);
-- One active plan per student. Recalculation supersedes the old plan instead of editing it.
CREATE UNIQUE INDEX IF NOT EXISTS "study_plans_one_active" ON "study_plans" ("student_id") WHERE "status" = 'ACTIVE';
ALTER TABLE "study_plans" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "study_plan_weeks" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "plan_id"     UUID NOT NULL REFERENCES "study_plans" ("id"),
  "week_index"  INTEGER NOT NULL,
  "starts_on"   DATE NOT NULL,
  CONSTRAINT "study_plan_weeks_unique" UNIQUE ("plan_id", "week_index")
);
ALTER TABLE "study_plan_weeks" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "study_plan_days" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "plan_id"     UUID NOT NULL REFERENCES "study_plans" ("id"),
  "week_id"     UUID NOT NULL REFERENCES "study_plan_weeks" ("id"),
  "day_date"    DATE NOT NULL,
  "minutes"     INTEGER NOT NULL,
  CONSTRAINT "study_plan_days_unique" UNIQUE ("plan_id", "day_date"),
  CONSTRAINT "study_plan_days_minutes_valid" CHECK ("minutes" BETWEEN 0 AND 300)
);
ALTER TABLE "study_plan_days" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "study_plan_tasks" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "plan_id"       UUID NOT NULL REFERENCES "study_plans" ("id"),
  "day_id"        UUID NOT NULL REFERENCES "study_plan_days" ("id"),
  "student_id"    UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "skill"         TEXT NOT NULL,
  "kind"          TEXT NOT NULL,
  "ref_type"      TEXT NOT NULL,
  "ref_id"        TEXT NOT NULL,
  "title"         TEXT NOT NULL,
  "minutes"       INTEGER NOT NULL,
  "sort"          INTEGER NOT NULL DEFAULT 0,
  "status"        TEXT NOT NULL DEFAULT 'PENDING',
  "rationale"     TEXT NOT NULL,
  "completed_at"  TIMESTAMP(3),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "study_plan_tasks_skill_valid" CHECK ("skill" IN ('LISTENING', 'READING', 'WRITING', 'SPEAKING', 'VOCABULARY', 'GRAMMAR')),
  CONSTRAINT "study_plan_tasks_ref_valid" CHECK ("ref_type" IN ('ASSESSMENT', 'CONTENT_ITEM', 'QUESTION_SET', 'VOCABULARY_REVIEW', 'WRITING_TASK', 'SPEAKING_PART')),
  CONSTRAINT "study_plan_tasks_status_valid" CHECK ("status" IN ('PENDING', 'DONE', 'SKIPPED')),
  CONSTRAINT "study_plan_tasks_minutes_valid" CHECK ("minutes" BETWEEN 1 AND 180)
);
CREATE INDEX IF NOT EXISTS "study_plan_tasks_student_day_idx" ON "study_plan_tasks" ("student_id", "day_id");
ALTER TABLE "study_plan_tasks" ENABLE ROW LEVEL SECURITY;

-- ── Vocabulary ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "vocabulary_items" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "word"             TEXT NOT NULL,
  "definition"       TEXT NOT NULL,
  "part_of_speech"   TEXT,
  "synonyms"         TEXT[] NOT NULL DEFAULT '{}',
  "antonyms"         TEXT[] NOT NULL DEFAULT '{}',
  "ielts_relevance"  TEXT,
  "example"          TEXT,
  "topic"            TEXT,
  "difficulty"       INTEGER NOT NULL DEFAULT 3,
  "status"           TEXT NOT NULL DEFAULT 'DRAFT',
  "created_by"       UUID REFERENCES "users" ("id"),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vocabulary_items_difficulty_valid" CHECK ("difficulty" BETWEEN 1 AND 5),
  CONSTRAINT "vocabulary_items_status_valid" CHECK ("status" IN ('DRAFT', 'APPROVED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "vocabulary_items_word_unique" ON "vocabulary_items" (lower("word"));
ALTER TABLE "vocabulary_items" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "student_vocabulary" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id"       UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "item_id"          UUID NOT NULL REFERENCES "vocabulary_items" ("id"),
  "status"           TEXT NOT NULL DEFAULT 'SAVED',
  "ease"             DECIMAL(4,2) NOT NULL DEFAULT 2.5,
  "interval_days"    INTEGER NOT NULL DEFAULT 0,
  "next_review_at"   TIMESTAMP(3),
  "review_count"     INTEGER NOT NULL DEFAULT 0,
  "correct_count"    INTEGER NOT NULL DEFAULT 0,
  "last_reviewed_at" TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_vocabulary_unique" UNIQUE ("student_id", "item_id"),
  CONSTRAINT "student_vocabulary_status_valid" CHECK ("status" IN ('SAVED', 'REVIEW', 'NEED_PRACTICE', 'MASTERED')),
  CONSTRAINT "student_vocabulary_counts_valid" CHECK ("review_count" >= 0 AND "correct_count" >= 0 AND "correct_count" <= "review_count"),
  CONSTRAINT "student_vocabulary_ease_valid" CHECK ("ease" >= 1.3)
);
CREATE INDEX IF NOT EXISTS "student_vocabulary_due_idx" ON "student_vocabulary" ("student_id", "next_review_at");
ALTER TABLE "student_vocabulary" ENABLE ROW LEVEL SECURITY;

-- Review history is append-only: it is what the correct rate is calculated from.
CREATE TABLE IF NOT EXISTS "vocabulary_reviews" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_vocabulary_id" UUID NOT NULL REFERENCES "student_vocabulary" ("id"),
  "correct"               BOOLEAN NOT NULL,
  "reviewed_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "vocabulary_reviews_card_idx" ON "vocabulary_reviews" ("student_vocabulary_id", "reviewed_at");
ALTER TABLE "vocabulary_reviews" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE TRIGGER "vocabulary_reviews_immutable" BEFORE UPDATE OR DELETE ON "vocabulary_reviews"
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Grammar ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "grammar_categories" (
  "code"   TEXT PRIMARY KEY,
  "label"  TEXT NOT NULL,
  "sort"   INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE "grammar_categories" ENABLE ROW LEVEL SECURITY;

INSERT INTO "grammar_categories" ("code", "label", "sort") VALUES
  ('ARTICLES', 'Articles', 1), ('TENSES', 'Tenses', 2), ('PREPOSITIONS', 'Prepositions', 3),
  ('SUBJECT_VERB', 'Subject-verb agreement', 4), ('WORD_FORM', 'Word forms', 5),
  ('FRAGMENTS', 'Sentence fragments', 6), ('RUN_ONS', 'Run-on sentences', 7),
  ('CONDITIONALS', 'Conditionals', 8), ('COMPLEX', 'Complex sentences', 9),
  ('PUNCTUATION', 'Punctuation', 10), ('OTHER', 'Other', 99)
ON CONFLICT ("code") DO NOTHING;

-- Historical observations, append-only. A recurring error is counted per month, not overwritten.
CREATE TABLE IF NOT EXISTS "grammar_observations" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id"            UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "category_code"         TEXT NOT NULL REFERENCES "grammar_categories" ("code"),
  "source"                TEXT NOT NULL,
  "writing_evaluation_id" UUID REFERENCES "writing_evaluations" ("id"),
  "excerpt"               TEXT NOT NULL,
  "correction"            TEXT,
  "observed_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "grammar_observations_source_valid" CHECK ("source" IN ('AI_WRITING', 'TEACHER', 'AI_SPEAKING'))
);
CREATE INDEX IF NOT EXISTS "grammar_observations_student_idx" ON "grammar_observations" ("student_id", "observed_at");
ALTER TABLE "grammar_observations" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE TRIGGER "grammar_observations_immutable" BEFORE UPDATE OR DELETE ON "grammar_observations"
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Writing evaluations may be linked to one observation per excerpt, so re-running an evaluation never double-counts.
CREATE UNIQUE INDEX IF NOT EXISTS "grammar_observations_one_per_excerpt" ON "grammar_observations" ("writing_evaluation_id", "excerpt") WHERE "writing_evaluation_id" IS NOT NULL;
