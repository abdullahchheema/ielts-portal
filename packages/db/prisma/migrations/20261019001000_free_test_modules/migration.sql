-- Free test v2: the fixed 3-config bundle is replaced by pool-based rotation across however many
-- Listening/Reading/Writing/Speaking modules are published (see FreeTestService). The free test is
-- now a full 4-skill mock orchestrated as an ExamAttempt, exactly like the authenticated simulator.
-- Safe to drop destructively: this table/these columns were never populated in production — the
-- feature shipped with no free-test content uploaded yet.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

ALTER TABLE "free_assessment_leads" DROP CONSTRAINT IF EXISTS "free_assessment_leads_assigned_config_id_fkey";
ALTER TABLE "free_assessment_leads" DROP CONSTRAINT IF EXISTS "free_assessment_leads_attempt_id_fkey";
DROP INDEX IF EXISTS "free_assessment_leads_assigned_config_id_idx";
DROP INDEX IF EXISTS "free_leads_config_idx";

ALTER TABLE "free_assessment_leads" DROP COLUMN IF EXISTS "assigned_config_id";
ALTER TABLE "free_assessment_leads" DROP COLUMN IF EXISTS "attempt_id";
ALTER TABLE "free_assessment_leads" ADD COLUMN IF NOT EXISTS "exam_attempt_id" UUID;

ALTER TABLE "free_assessment_leads"
  ADD CONSTRAINT "free_assessment_leads_exam_attempt_id_fkey" FOREIGN KEY ("exam_attempt_id") REFERENCES "exam_attempts" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
CREATE UNIQUE INDEX IF NOT EXISTS "free_assessment_leads_exam_attempt_id_key" ON "free_assessment_leads" ("exam_attempt_id");

DROP TABLE IF EXISTS "free_test_configs" CASCADE;
