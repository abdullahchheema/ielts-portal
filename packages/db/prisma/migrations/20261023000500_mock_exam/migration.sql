-- Phase 6: whole-module mock-test rotation. MockAccessRequest/MockActivation gain a nullable
-- mock_exam_id alongside the now-nullable assessment_id — exactly one is set per row. Pre-existing
-- rows keep their assessment_id untouched; only new, bundle-based requests/activations use
-- mock_exam_id.
ALTER TABLE "mock_access_requests" DROP CONSTRAINT "mock_access_requests_assessment_id_fkey";
ALTER TABLE "mock_activations" DROP CONSTRAINT "mock_activations_assessment_id_fkey";

ALTER TABLE "mock_access_requests" ADD COLUMN "mock_exam_id" UUID, ALTER COLUMN "assessment_id" DROP NOT NULL;
ALTER TABLE "mock_activations" ADD COLUMN "mock_exam_id" UUID, ALTER COLUMN "assessment_id" DROP NOT NULL;

CREATE TABLE "mock_exams" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "listening_set_id" UUID NOT NULL,
    "reading_set_id" UUID NOT NULL,
    "listening_assessment_id" UUID NOT NULL,
    "reading_assessment_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "library_visible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_exams_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mock_activations_batch_id_mock_exam_id_key" ON "mock_activations"("batch_id", "mock_exam_id");

ALTER TABLE "mock_access_requests" ADD CONSTRAINT "mock_access_requests_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mock_access_requests" ADD CONSTRAINT "mock_access_requests_mock_exam_id_fkey" FOREIGN KEY ("mock_exam_id") REFERENCES "mock_exams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "mock_activations" ADD CONSTRAINT "mock_activations_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mock_activations" ADD CONSTRAINT "mock_activations_mock_exam_id_fkey" FOREIGN KEY ("mock_exam_id") REFERENCES "mock_exams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "mock_exams" ADD CONSTRAINT "mock_exams_listening_set_id_fkey" FOREIGN KEY ("listening_set_id") REFERENCES "question_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mock_exams" ADD CONSTRAINT "mock_exams_reading_set_id_fkey" FOREIGN KEY ("reading_set_id") REFERENCES "question_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mock_exams" ADD CONSTRAINT "mock_exams_listening_assessment_id_fkey" FOREIGN KEY ("listening_assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mock_exams" ADD CONSTRAINT "mock_exams_reading_assessment_id_fkey" FOREIGN KEY ("reading_assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
