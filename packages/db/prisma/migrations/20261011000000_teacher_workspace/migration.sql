-- Teacher workspace: autosaved grading drafts and cached batch health. Additive.
-- Drafts are not grades. A final grade still goes through the immutable grading path, and the draft is discarded then.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS "grading_drafts" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "submission_id" UUID NOT NULL REFERENCES "submissions" ("id"),
  "mentor_id"     UUID NOT NULL REFERENCES "mentor_profiles" ("id"),
  "scores"        JSONB NOT NULL DEFAULT '[]'::jsonb,
  "comment"       TEXT,
  "revision"      INTEGER NOT NULL DEFAULT 1,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "grading_drafts_unique" UNIQUE ("submission_id", "mentor_id"),
  CONSTRAINT "grading_drafts_revision_valid" CHECK ("revision" >= 1)
);
ALTER TABLE "grading_drafts" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "batch_health_snapshots" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "batch_id"    UUID NOT NULL REFERENCES "batches" ("id"),
  "payload"     JSONB NOT NULL,
  "inputs_hash" TEXT NOT NULL,
  "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "batch_health_snapshots_unique" UNIQUE ("batch_id")
);
ALTER TABLE "batch_health_snapshots" ENABLE ROW LEVEL SECURITY;
