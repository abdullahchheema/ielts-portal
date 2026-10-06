-- Engagement: attendance history and corrections, warnings, inactivity, class session status, recordings, leaderboards.
-- Additive. Attendance is never overwritten silently: every change is an append-only event, and changes after the
-- edit window go through a correction that an administrator approves.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

-- ── Attendance history and corrections ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "attendance_events" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id"    UUID NOT NULL REFERENCES "live_sessions" ("id"),
  "student_id"    UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "action"        TEXT NOT NULL,
  "before_status" TEXT,
  "after_status"  TEXT,
  "actor_id"      UUID REFERENCES "users" ("id"),
  "reason"        TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_events_action_valid" CHECK ("action" IN ('MARKED', 'CHANGED', 'CORRECTION_APPLIED'))
);
CREATE INDEX IF NOT EXISTS "attendance_events_session_student_idx" ON "attendance_events" ("session_id", "student_id", "created_at");
ALTER TABLE "attendance_events" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE TRIGGER "attendance_events_immutable" BEFORE UPDATE OR DELETE ON "attendance_events"
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "attendance_corrections" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id"   UUID NOT NULL REFERENCES "live_sessions" ("id"),
  "student_id"   UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "requested_by" UUID NOT NULL REFERENCES "users" ("id"),
  "from_status"  TEXT,
  "to_status"    TEXT NOT NULL,
  "reason"       TEXT NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'PENDING',
  "decided_by"   UUID REFERENCES "users" ("id"),
  "decided_at"   TIMESTAMP(3),
  "decision_note" TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_corrections_status_valid" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED')),
  CONSTRAINT "attendance_corrections_to_valid" CHECK ("to_status" IN ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED')),
  CONSTRAINT "attendance_corrections_reason_len" CHECK (char_length("reason") BETWEEN 5 AND 500)
);
-- At most one open request per student and session.
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_corrections_one_pending" ON "attendance_corrections" ("session_id", "student_id") WHERE "status" = 'PENDING';
ALTER TABLE "attendance_corrections" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "attendance_warnings" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id"  UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "rule"        TEXT NOT NULL,
  "window_key"  TEXT NOT NULL,
  "message"     TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_warnings_unique" UNIQUE ("student_id", "rule", "window_key")
);
ALTER TABLE "attendance_warnings" ENABLE ROW LEVEL SECURITY;

-- ── Inactivity and engagement ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "student_engagement" (
  "student_id"          UUID PRIMARY KEY REFERENCES "student_profiles" ("id"),
  "status"              TEXT NOT NULL DEFAULT 'ACTIVE',
  "last_activity_at"    TIMESTAMP(3),
  "last_activity_label" TEXT,
  "reasons"             TEXT[] NOT NULL DEFAULT '{}',
  "computed_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_engagement_status_valid" CHECK ("status" IN ('ACTIVE', 'AT_RISK', 'INACTIVE', 'REACTIVATED'))
);
ALTER TABLE "student_engagement" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "engagement_status_history" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id"  UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "from_status" TEXT,
  "to_status"   TEXT NOT NULL,
  "reasons"     TEXT[] NOT NULL DEFAULT '{}',
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "engagement_status_history_student_idx" ON "engagement_status_history" ("student_id", "created_at");
ALTER TABLE "engagement_status_history" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE TRIGGER "engagement_status_history_immutable" BEFORE UPDATE OR DELETE ON "engagement_status_history"
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "follow_up_tasks" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id"  UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "assignee_id" UUID NOT NULL REFERENCES "users" ("id"),
  "due_at"      TIMESTAMP(3),
  "status"      TEXT NOT NULL DEFAULT 'OPEN',
  "note"        TEXT NOT NULL,
  "source"      TEXT NOT NULL DEFAULT 'MANUAL',
  "created_by"  UUID REFERENCES "users" ("id"),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "follow_up_tasks_status_valid" CHECK ("status" IN ('OPEN', 'DONE', 'CANCELLED')),
  CONSTRAINT "follow_up_tasks_source_valid" CHECK ("source" IN ('MANUAL', 'INACTIVITY', 'ATTENDANCE'))
);
CREATE INDEX IF NOT EXISTS "follow_up_tasks_assignee_idx" ON "follow_up_tasks" ("assignee_id", "status");
ALTER TABLE "follow_up_tasks" ENABLE ROW LEVEL SECURITY;

-- ── Class sessions: status, cancellation and live window ──────────────────
ALTER TABLE "live_sessions"
  ADD COLUMN IF NOT EXISTS "title" TEXT,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancel_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ended_at" TIMESTAMP(3);
DO $$ BEGIN
  ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_status_valid" CHECK ("status" IN ('SCHEDULED', 'LIVE', 'COMPLETED', 'CANCELLED'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Recordings ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "class_recordings" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id"   UUID NOT NULL REFERENCES "live_sessions" ("id"),
  "batch_id"     UUID NOT NULL REFERENCES "batches" ("id"),
  "storage_key"  TEXT UNIQUE,
  "external_url" TEXT,
  "duration_sec" INTEGER,
  "size_bytes"   BIGINT,
  "mime"         TEXT,
  "status"       TEXT NOT NULL DEFAULT 'READY',
  "availability" TEXT NOT NULL DEFAULT 'BATCH',
  "uploaded_by"  UUID NOT NULL REFERENCES "users" ("id"),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "class_recordings_status_valid" CHECK ("status" IN ('UPLOADING', 'READY', 'FAILED')),
  CONSTRAINT "class_recordings_availability_valid" CHECK ("availability" IN ('BATCH', 'ALL_STUDENTS', 'ALUMNI')),
  CONSTRAINT "class_recordings_source_present" CHECK ("storage_key" IS NOT NULL OR "external_url" IS NOT NULL OR "status" = 'UPLOADING'),
  CONSTRAINT "class_recordings_size_valid" CHECK ("size_bytes" IS NULL OR "size_bytes" <= 2147483648)
);
CREATE INDEX IF NOT EXISTS "class_recordings_batch_idx" ON "class_recordings" ("batch_id", "created_at");
ALTER TABLE "class_recordings" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "recording_views" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "recording_id"  UUID NOT NULL REFERENCES "class_recordings" ("id"),
  "student_id"    UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "position_sec"  INTEGER NOT NULL DEFAULT 0,
  "completed_at"  TIMESTAMP(3),
  "started_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recording_views_unique" UNIQUE ("recording_id", "student_id"),
  CONSTRAINT "recording_views_position_valid" CHECK ("position_sec" >= 0)
);
ALTER TABLE "recording_views" ENABLE ROW LEVEL SECURITY;

-- ── Leaderboards ───────────────────────────────────────────────────────────
ALTER TABLE "student_profiles" ADD COLUMN IF NOT EXISTS "leaderboard_opt_out" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS "leaderboard_snapshots" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "batch_id"     UUID NOT NULL REFERENCES "batches" ("id"),
  "period_type"  TEXT NOT NULL,
  "period_key"   TEXT NOT NULL,
  "entries"      JSONB NOT NULL,
  "computed_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leaderboard_snapshots_unique" UNIQUE ("batch_id", "period_type", "period_key"),
  CONSTRAINT "leaderboard_snapshots_period_valid" CHECK ("period_type" IN ('WEEKLY', 'MONTHLY'))
);
ALTER TABLE "leaderboard_snapshots" ENABLE ROW LEVEL SECURITY;
