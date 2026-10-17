-- Phase 4 of the four-tier plan initiative: the free, anonymous diagnostic-test flow. Three fixed
-- free test configurations rotate among leads identified by normalized email+phone (no account
-- creation). Each lead gets exactly one entitlement, enforced by the unique identity index below.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS "free_test_configs" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"          TEXT NOT NULL,
  "assessment_id" UUID NOT NULL REFERENCES "assessments" ("id"),
  "sequence"      INTEGER NOT NULL DEFAULT 0,
  "active"        BOOLEAN NOT NULL DEFAULT true,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "free_test_configs_active_idx" ON "free_test_configs" ("active", "sequence");
ALTER TABLE "free_test_configs" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "free_assessment_leads" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email"              TEXT NOT NULL,
  "phone"              TEXT NOT NULL,
  "email_normalized"   TEXT NOT NULL,
  "phone_normalized"   TEXT NOT NULL,
  "assigned_config_id" UUID NOT NULL REFERENCES "free_test_configs" ("id"),
  "ghost_student_id"   UUID REFERENCES "student_profiles" ("id") ON DELETE SET NULL,
  "attempt_id"         UUID REFERENCES "assessment_attempts" ("id") ON DELETE SET NULL,
  "status"             TEXT NOT NULL DEFAULT 'CLAIMED',
  "linked_student_id"  UUID REFERENCES "student_profiles" ("id") ON DELETE SET NULL,
  "ip_address"         TEXT,
  "user_agent"         TEXT,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"         TIMESTAMP(3),
  CONSTRAINT "free_leads_status_valid" CHECK ("status" IN ('CLAIMED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED'))
);
-- One entitlement per normalized identity: the real anti-abuse gate for the free test.
CREATE UNIQUE INDEX IF NOT EXISTS "free_leads_identity_unique" ON "free_assessment_leads" ("email_normalized", "phone_normalized");
CREATE INDEX IF NOT EXISTS "free_leads_config_idx" ON "free_assessment_leads" ("assigned_config_id");
CREATE INDEX IF NOT EXISTS "free_leads_ghost_student_idx" ON "free_assessment_leads" ("ghost_student_id");
ALTER TABLE "free_assessment_leads" ENABLE ROW LEVEL SECURITY;
