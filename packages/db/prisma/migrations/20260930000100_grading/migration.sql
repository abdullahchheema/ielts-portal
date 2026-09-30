-- Writing/speaking grading: assignment settings, submission lifecycle, per-grading criterion scores.
ALTER TABLE "assignments"
  ADD COLUMN "skill" TEXT NOT NULL DEFAULT 'WRITING',
  ADD COLUMN "rubric_id" UUID,
  ADD COLUMN "min_words" INTEGER,
  ADD CONSTRAINT "assignment_skill_valid" CHECK ("skill" IN ('WRITING', 'SPEAKING')),
  ADD CONSTRAINT "assignments_rubric_id_fkey" FOREIGN KEY ("rubric_id") REFERENCES "rubrics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "assignments_content_item_id_key" ON "assignments"("content_item_id");

ALTER TABLE "submissions"
  ADD COLUMN "enrollment_id" UUID,
  ADD COLUMN "word_count" INTEGER,
  ADD COLUMN "file_mime" TEXT,
  ADD COLUMN "late" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "graded_at" TIMESTAMP(3),
  ADD COLUMN "final_band" DECIMAL(3,1),
  ADD CONSTRAINT "submission_status_valid" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'GRADED')),
  ADD CONSTRAINT "submission_band_valid" CHECK ("final_band" IS NULL OR ("final_band" BETWEEN 0 AND 9 AND "final_band" * 2 = floor("final_band" * 2))),
  ADD CONSTRAINT "submissions_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- One draft-or-awaiting-grading submission per student per assignment (double-click / second-tab safe).
CREATE UNIQUE INDEX "submissions_one_open" ON "submissions"("assignment_id", "student_id") WHERE "status" IN ('DRAFT', 'SUBMITTED');
CREATE INDEX "submissions_status_submitted_at_idx" ON "submissions"("status", "submitted_at");
CREATE INDEX "submissions_student_id_idx" ON "submissions"("student_id");

ALTER TABLE "rubric_scores"
  ADD COLUMN "feedback_id" UUID,
  ADD CONSTRAINT "rubric_scores_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "submission_feedback"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grades are history: feedback and scores are never edited or deleted, a regrade adds new rows.
CREATE TRIGGER "submission_feedback_immutable" BEFORE UPDATE OR DELETE ON "submission_feedback" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "rubric_scores_immutable" BEFORE UPDATE OR DELETE ON "rubric_scores" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
