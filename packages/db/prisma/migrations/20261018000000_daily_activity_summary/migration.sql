-- One row per user per calendar day: counts only, never a timestamped event log. Backs the admin
-- "daily activity summary" view for students and teachers (logins, mocks taken, lessons opened,
-- submissions made, classes attended) without minute-by-minute session/page tracking.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS "daily_activity_summaries" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"           UUID NOT NULL REFERENCES "users" ("id"),
  "date"              DATE NOT NULL,
  "login_count"       INTEGER NOT NULL DEFAULT 0,
  "mock_tests_taken"  INTEGER NOT NULL DEFAULT 0,
  "lessons_opened"    INTEGER NOT NULL DEFAULT 0,
  "submissions_made"  INTEGER NOT NULL DEFAULT 0,
  "classes_attended"  INTEGER NOT NULL DEFAULT 0,
  "last_active_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_activity_summaries_unique" UNIQUE ("user_id", "date"),
  CONSTRAINT "daily_activity_summaries_counts_non_negative" CHECK (
    "login_count" >= 0 AND "mock_tests_taken" >= 0 AND "lessons_opened" >= 0 AND
    "submissions_made" >= 0 AND "classes_attended" >= 0
  )
);
CREATE INDEX IF NOT EXISTS "daily_activity_summaries_date_idx" ON "daily_activity_summaries" ("date");
ALTER TABLE "daily_activity_summaries" ENABLE ROW LEVEL SECURITY;
