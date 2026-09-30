-- Assessment engine: authoring fields, timed attempts, per-assessment attempt numbering.
ALTER TABLE "assessments"
  ADD COLUMN "skill" TEXT,
  ADD COLUMN "pass_percent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "show_answers" BOOLEAN NOT NULL DEFAULT true,
  ADD CONSTRAINT "assessment_pass_percent_valid" CHECK ("pass_percent" BETWEEN 0 AND 100),
  ADD CONSTRAINT "assessment_skill_valid" CHECK ("skill" IS NULL OR "skill" IN ('LISTENING', 'READING', 'WRITING', 'SPEAKING'));

ALTER TABLE "assessment_sections" ADD COLUMN "content" JSONB;
ALTER TABLE "questions" ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "assessment_attempts"
  ADD COLUMN "assessment_id" UUID NOT NULL,
  ADD COLUMN "expires_at" TIMESTAMP(3),
  ADD COLUMN "percent" DECIMAL(5,2),
  ADD CONSTRAINT "attempt_percent_valid" CHECK ("percent" IS NULL OR "percent" BETWEEN 0 AND 100);

ALTER TABLE "assessment_attempts"
  ADD CONSTRAINT "assessment_attempts_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "assessment_attempts_assessment_version_id_student_id_attemp_key";
CREATE UNIQUE INDEX "assessment_attempts_assessment_id_student_id_attempt_number_key" ON "assessment_attempts"("assessment_id", "student_id", "attempt_number");
CREATE INDEX "assessment_attempts_student_id_status_idx" ON "assessment_attempts"("student_id", "status");
-- At most one in-progress attempt per student per assessment (start is idempotent under double-click races).
CREATE UNIQUE INDEX "assessment_attempts_one_in_progress" ON "assessment_attempts"("assessment_id", "student_id") WHERE "status" = 'IN_PROGRESS';
CREATE INDEX "band_conversion_lookup_idx" ON "band_conversion_tables"("test_type", "version", "raw_min");
