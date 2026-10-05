-- Analytics spine: additive only. No table is created, no column is dropped, renamed or retyped,
-- and no existing data is rewritten. Everything here is either a nullable column (no default,
-- so no table rewrite on PostgreSQL 11+) or an index.
--
-- Hand-written, not generated: `prisma migrate dev` is banned for this database (no shadow
-- database is configured). Applied with `prisma migrate deploy` only.

-- Fail fast instead of queueing behind live traffic (Supabase production).
SET lock_timeout = '3s';
SET statement_timeout = '120s';

-- ── Attendance: optional note and the time the status was set ─────────────────
-- markedAt is NULL for rows created before this migration. That is deliberate: we do not
-- backfill a timestamp we never recorded.
ALTER TABLE "attendance"
  ADD COLUMN IF NOT EXISTS "note" TEXT,
  ADD COLUMN IF NOT EXISTS "marked_at" TIMESTAMP(3);

-- ── Student profile: per-skill target bands ───────────────────────────────────
ALTER TABLE "student_profiles"
  ADD COLUMN IF NOT EXISTS "target_listening" DECIMAL(3,1),
  ADD COLUMN IF NOT EXISTS "target_reading"   DECIMAL(3,1),
  ADD COLUMN IF NOT EXISTS "target_writing"   DECIMAL(3,1),
  ADD COLUMN IF NOT EXISTS "target_speaking"  DECIMAL(3,1);

-- Same rule as the existing student_target_band_valid: half-band steps between 0 and 9.
-- PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS, so each is guarded.
DO $$ BEGIN
  ALTER TABLE "student_profiles" ADD CONSTRAINT "student_target_listening_valid"
    CHECK ("target_listening" IS NULL OR ("target_listening" BETWEEN 0 AND 9 AND "target_listening" * 2 = floor("target_listening" * 2)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "student_profiles" ADD CONSTRAINT "student_target_reading_valid"
    CHECK ("target_reading" IS NULL OR ("target_reading" BETWEEN 0 AND 9 AND "target_reading" * 2 = floor("target_reading" * 2)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "student_profiles" ADD CONSTRAINT "student_target_writing_valid"
    CHECK ("target_writing" IS NULL OR ("target_writing" BETWEEN 0 AND 9 AND "target_writing" * 2 = floor("target_writing" * 2)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "student_profiles" ADD CONSTRAINT "student_target_speaking_valid"
    CHECK ("target_speaking" IS NULL OR ("target_speaking" BETWEEN 0 AND 9 AND "target_speaking" * 2 = floor("target_speaking" * 2)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Indexes for analytics queries ─────────────────────────────────────────────
-- Plain CREATE INDEX (not CONCURRENTLY): CONCURRENTLY cannot run inside Prisma's migration
-- transaction. At current table sizes each build takes milliseconds. If a table ever reaches
-- roughly a million rows, move these to a separately applied script built with CONCURRENTLY.
CREATE INDEX IF NOT EXISTS "attendance_student_id_status_idx"                    ON "attendance" ("student_id", "status");
CREATE INDEX IF NOT EXISTS "enrollments_batch_id_status_idx"                     ON "enrollments" ("batch_id", "status");
CREATE INDEX IF NOT EXISTS "enrollments_status_enrolled_at_idx"                  ON "enrollments" ("status", "enrolled_at");
CREATE INDEX IF NOT EXISTS "attempt_answers_question_version_id_is_correct_idx"  ON "attempt_answers" ("question_version_id", "is_correct");
CREATE INDEX IF NOT EXISTS "assessment_attempts_submitted_at_idx"                ON "assessment_attempts" ("submitted_at");
CREATE INDEX IF NOT EXISTS "content_progress_content_item_id_status_idx"         ON "content_progress" ("content_item_id", "status");
CREATE INDEX IF NOT EXISTS "batch_mentors_mentor_id_idx"                         ON "batch_mentors" ("mentor_id");
CREATE INDEX IF NOT EXISTS "payments_order_id_idx"                               ON "payments" ("order_id");
CREATE INDEX IF NOT EXISTS "payments_status_created_at_idx"                      ON "payments" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "orders_status_created_at_idx"                        ON "orders" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_created_at_idx"                   ON "audit_logs" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_action_created_at_idx"                    ON "audit_logs" ("action", "created_at");
CREATE INDEX IF NOT EXISTS "submission_feedback_mentor_id_created_at_idx"        ON "submission_feedback" ("mentor_id", "created_at");
CREATE INDEX IF NOT EXISTS "live_sessions_mentor_id_starts_at_idx"               ON "live_sessions" ("mentor_id", "starts_at");
CREATE INDEX IF NOT EXISTS "submissions_assignment_id_status_idx"                ON "submissions" ("assignment_id", "status");
CREATE INDEX IF NOT EXISTS "submissions_graded_at_idx"                           ON "submissions" ("graded_at");
