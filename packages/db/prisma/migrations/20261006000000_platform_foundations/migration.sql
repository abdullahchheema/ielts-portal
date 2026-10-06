-- Platform foundations (phase 0): additive only.
-- New permission keys and their role grants, RLS for the teacher_* tables that were missed,
-- and the tables for AI request records, background jobs, scheduler leases and delivery history.
-- Hand-written: `prisma migrate dev` is banned for this database. Applied with `prisma migrate deploy`.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

-- ── RBAC: new permission keys ───────────────────────────────────────────────
INSERT INTO "permissions" ("id", "key")
SELECT gen_random_uuid(), k FROM unnest(ARRAY[
  'attendance.correct', 'knowledge.manage', 'ai.support.use', 'payment.reconcile',
  'referral.manage', 'feedback.view', 'lifecycle.manage', 'engagement.followup',
  'question.manage', 'class.manage'
]) AS k
ON CONFLICT ("key") DO NOTHING;

-- Grants. Role names match the seed (SUPER_ADMIN, ACADEMIC_ADMIN, CONTENT_MANAGER,
-- FINANCE_ADMIN, SUPPORT_AGENT, MENTOR). SUPER_ADMIN receives every key.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = ANY (ARRAY[
  'attendance.correct', 'knowledge.manage', 'ai.support.use', 'payment.reconcile',
  'referral.manage', 'feedback.view', 'lifecycle.manage', 'engagement.followup',
  'question.manage', 'class.manage'
])
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON (
  (r."name" = 'ACADEMIC_ADMIN' AND p."key" = ANY (ARRAY['attendance.correct', 'knowledge.manage', 'ai.support.use', 'feedback.view', 'lifecycle.manage', 'engagement.followup', 'question.manage', 'class.manage']))
  OR (r."name" = 'CONTENT_MANAGER' AND p."key" = ANY (ARRAY['knowledge.manage', 'question.manage']))
  OR (r."name" = 'FINANCE_ADMIN' AND p."key" = ANY (ARRAY['ai.support.use', 'payment.reconcile', 'referral.manage']))
  OR (r."name" = 'SUPPORT_AGENT' AND p."key" = ANY (ARRAY['ai.support.use', 'engagement.followup']))
  OR (r."name" = 'MENTOR' AND p."key" = ANY (ARRAY['class.manage']))
)
ON CONFLICT DO NOTHING;

-- ── RLS gap: teacher application tables were created without RLS (migration 20261002) ──
ALTER TABLE "teacher_applications"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teacher_educations"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teacher_experiences"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teacher_certifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teacher_references"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teacher_documents"      ENABLE ROW LEVEL SECURITY;

-- ── AI request records (metadata only: never prompts, responses or secrets) ─────
CREATE TABLE IF NOT EXISTS "ai_requests" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "feature"       TEXT NOT NULL,
  "user_id"       UUID,
  "provider"      TEXT NOT NULL,
  "model"         TEXT NOT NULL,
  "status"        TEXT NOT NULL,
  "input_hash"    TEXT,
  "latency_ms"    INTEGER,
  "tokens_in"     INTEGER,
  "tokens_out"    INTEGER,
  "cost_estimate" DECIMAL(10,4),
  "error_code"    TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_requests_status_valid" CHECK ("status" IN ('SUCCEEDED', 'FAILED', 'CACHED', 'UNAVAILABLE'))
);
CREATE INDEX IF NOT EXISTS "ai_requests_user_created_idx" ON "ai_requests" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_requests_feature_created_idx" ON "ai_requests" ("feature", "created_at");
ALTER TABLE "ai_requests" ENABLE ROW LEVEL SECURITY;

-- ── Background jobs (claimed with FOR UPDATE SKIP LOCKED) ─────────────────────
CREATE TABLE IF NOT EXISTS "jobs" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_key"      TEXT NOT NULL,
  "type"         TEXT NOT NULL,
  "payload"      JSONB,
  "status"       TEXT NOT NULL DEFAULT 'QUEUED',
  "attempts"     INTEGER NOT NULL DEFAULT 0,
  "run_after"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_until" TIMESTAMP(3),
  "last_error"   TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "jobs_status_valid" CHECK ("status" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "jobs_job_key_unique" ON "jobs" ("job_key");
CREATE INDEX IF NOT EXISTS "jobs_claim_idx" ON "jobs" ("status", "run_after");
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;

-- ── Scheduler: one row per task, lease held while a run is in progress ─────────
CREATE TABLE IF NOT EXISTS "scheduled_task_runs" (
  "task_name"    TEXT PRIMARY KEY,
  "last_run_at"  TIMESTAMP(3),
  "next_run_at"  TIMESTAMP(3),
  "locked_until" TIMESTAMP(3),
  "last_status"  TEXT,
  "last_error"   TEXT,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "scheduled_task_runs" ENABLE ROW LEVEL SECURITY;

-- ── Notification delivery history (one row per attempted channel) ─────────────
CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "notification_id" UUID NOT NULL REFERENCES "notifications" ("id"),
  "channel"         TEXT NOT NULL,
  "status"          TEXT NOT NULL,
  "provider_id"     TEXT,
  "error"           TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_deliveries_status_valid" CHECK ("status" IN ('SENT', 'FAILED', 'SKIPPED'))
);
CREATE INDEX IF NOT EXISTS "notification_deliveries_notification_idx" ON "notification_deliveries" ("notification_id");
ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;

-- Delivery rows are history: they cannot be edited or deleted.
DO $$ BEGIN
  CREATE TRIGGER "notification_deliveries_immutable"
    BEFORE UPDATE OR DELETE ON "notification_deliveries"
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
