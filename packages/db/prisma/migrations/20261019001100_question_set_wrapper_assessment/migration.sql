SET lock_timeout = '3s';
SET statement_timeout = '120s';

ALTER TABLE "question_sets" ADD COLUMN IF NOT EXISTS "wrapper_assessment_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "question_sets_wrapper_assessment_id_key" ON "question_sets" ("wrapper_assessment_id");

ALTER TABLE "question_sets"
  ADD CONSTRAINT "question_sets_wrapper_assessment_id_fkey" FOREIGN KEY ("wrapper_assessment_id") REFERENCES "assessments" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
