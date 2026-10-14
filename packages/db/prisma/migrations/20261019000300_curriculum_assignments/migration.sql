-- Teacher-to-batch/student content assignment. The existing `Assignment` model is a 1:1 fixture on
-- a ContentItem that applies to every student in the course once published — there was no way for a
-- teacher to target one specific batch or a named student. This is additive, not a replacement.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS "curriculum_assignments" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "content_item_id" UUID NOT NULL REFERENCES "content_items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "batch_id"        UUID REFERENCES "batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "student_id"      UUID REFERENCES "student_profiles" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "requirement"     TEXT NOT NULL DEFAULT 'REQUIRED',
  "due_at"          TIMESTAMP(3),
  "instructions"    TEXT,
  "assigned_by"     UUID REFERENCES "users" ("id"),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "curriculum_assignments_requirement_valid" CHECK ("requirement" IN ('REQUIRED', 'RECOMMENDED')),
  CONSTRAINT "curriculum_assignments_one_target" CHECK (("batch_id" IS NOT NULL) <> ("student_id" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "curriculum_assignments_content_item_idx" ON "curriculum_assignments" ("content_item_id");
CREATE INDEX IF NOT EXISTS "curriculum_assignments_batch_idx" ON "curriculum_assignments" ("batch_id");
CREATE INDEX IF NOT EXISTS "curriculum_assignments_student_idx" ON "curriculum_assignments" ("student_id");
ALTER TABLE "curriculum_assignments" ENABLE ROW LEVEL SECURITY;
