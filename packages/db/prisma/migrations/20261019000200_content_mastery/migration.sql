-- Mastery vs. completion: no tier beyond COMPLETED exists today, so a lesson merely watched counts
-- the same as a unit whose mastery check was actually passed. `content_items.mastery_percent` is an
-- opt-in per-item threshold (NULL = ordinary item, no change in behaviour); `content_progress.mastered_at`
-- is set once an item with a threshold has a best score at or above it (via its own linked assessment,
-- the same metadata_json.assessmentId already used for SCORE_BASED release and best-score lookups).

SET lock_timeout = '3s';
SET statement_timeout = '120s';

ALTER TABLE "content_items" ADD COLUMN IF NOT EXISTS "mastery_percent" INTEGER;
DO $$ BEGIN
  ALTER TABLE "content_items" ADD CONSTRAINT "content_items_mastery_percent_valid" CHECK ("mastery_percent" IS NULL OR "mastery_percent" BETWEEN 1 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "content_progress" ADD COLUMN IF NOT EXISTS "mastered_at" TIMESTAMP(3);
