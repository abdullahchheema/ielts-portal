-- Rotation eligibility: per-set opt-out from automatic free-test rotation, scoped per skill via
-- the set's own `skill` column. Defaults true so every existing set keeps rotating unchanged until
-- an admin explicitly excludes one.
ALTER TABLE "question_sets" ADD COLUMN "eligible_for_free_test_rotation" BOOLEAN NOT NULL DEFAULT true;

-- Backfill: the DRAFT/APPROVED stage no longer exists. Move those sets to ARCHIVED rather than
-- PUBLISHED — publishing them automatically would make previously-unreviewed content immediately
-- visible to students, which is never the safe direction for a one-time backfill.
UPDATE "question_sets" SET "status" = 'ARCHIVED' WHERE "status" IN ('DRAFT', 'APPROVED');

-- Collapse the status model to PUBLISHED/ARCHIVED only. New sets land PUBLISHED by default (there's
-- no more draft stage to create them into).
ALTER TABLE "question_sets" ALTER COLUMN "status" SET DEFAULT 'PUBLISHED';
ALTER TABLE "question_sets" DROP CONSTRAINT IF EXISTS "question_sets_status_valid";
ALTER TABLE "question_sets" ADD CONSTRAINT "question_sets_status_valid" CHECK ("status" IN ('PUBLISHED', 'ARCHIVED'));
