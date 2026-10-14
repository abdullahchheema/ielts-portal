-- Academic/General Training track on course content. `student_profiles.academic_or_general` and
-- `question_sets.module` already carry this same ACADEMIC/GENERAL/BOTH distinction; course_sections
-- and content_items never did, so a student's track could never actually filter what they see.
-- Default 'BOTH' is a no-op for every existing row — nothing currently shown changes.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

ALTER TABLE "course_sections" ADD COLUMN IF NOT EXISTS "module" TEXT NOT NULL DEFAULT 'BOTH';
DO $$ BEGIN
  ALTER TABLE "course_sections" ADD CONSTRAINT "course_sections_module_valid" CHECK ("module" IN ('ACADEMIC', 'GENERAL', 'BOTH'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "content_items" ADD COLUMN IF NOT EXISTS "module" TEXT NOT NULL DEFAULT 'BOTH';
DO $$ BEGIN
  ALTER TABLE "content_items" ADD CONSTRAINT "content_items_module_valid" CHECK ("module" IN ('ACADEMIC', 'GENERAL', 'BOTH'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
