-- Mock-test access control: a student requests access to one mock, or a teacher/admin opens a mock
-- for an entire batch at once. `assessments.library_visible` alone never granted real per-student
-- access; this adds the missing state, enforced server-side in AttemptsService.resolveAccess() —
-- never just a hidden button. Composing/publishing mocks (mock_exams/) is untouched.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS "mock_access_requests" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "assessment_id"   UUID NOT NULL REFERENCES "assessments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "student_id"      UUID NOT NULL REFERENCES "student_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "batch_id"        UUID REFERENCES "batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "reason"          TEXT,
  "reviewed_by"     UUID REFERENCES "users" ("id"),
  "reviewed_at"     TIMESTAMP(3),
  "decision_note"   TEXT,
  "available_from"  TIMESTAMP(3),
  "available_until" TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mock_access_requests_status_valid" CHECK ("status" IN ('PENDING', 'APPROVED', 'DECLINED', 'EXPIRED')),
  CONSTRAINT "mock_access_requests_window_valid" CHECK ("available_until" IS NULL OR "available_from" IS NULL OR "available_until" > "available_from")
);
-- Only one open request per student per mock at a time.
CREATE UNIQUE INDEX IF NOT EXISTS "mock_access_requests_one_pending" ON "mock_access_requests" ("student_id", "assessment_id") WHERE ("status" = 'PENDING');
CREATE INDEX IF NOT EXISTS "mock_access_requests_student_idx" ON "mock_access_requests" ("student_id");
CREATE INDEX IF NOT EXISTS "mock_access_requests_batch_idx" ON "mock_access_requests" ("batch_id");
ALTER TABLE "mock_access_requests" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "mock_activations" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "assessment_id"   UUID NOT NULL REFERENCES "assessments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "batch_id"        UUID NOT NULL REFERENCES "batches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status"          TEXT NOT NULL DEFAULT 'ACTIVE',
  "available_from"  TIMESTAMP(3) NOT NULL,
  "available_until" TIMESTAMP(3),
  "instructions"    TEXT,
  "activated_by"    UUID REFERENCES "users" ("id"),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mock_activations_unique" UNIQUE ("batch_id", "assessment_id"),
  CONSTRAINT "mock_activations_status_valid" CHECK ("status" IN ('ACTIVE', 'CANCELLED')),
  CONSTRAINT "mock_activations_window_valid" CHECK ("available_until" IS NULL OR "available_until" > "available_from")
);
CREATE INDEX IF NOT EXISTS "mock_activations_batch_idx" ON "mock_activations" ("batch_id");
ALTER TABLE "mock_activations" ENABLE ROW LEVEL SECURITY;
