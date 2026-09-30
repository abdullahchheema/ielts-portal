-- The academy sells ONE course (Complete IELTS Preparation) in batches with no size limit.

-- ── Batches: no capacity, richer schedule, no FULL status ──────────────────
ALTER TABLE "batches" DROP COLUMN "capacity";   -- also drops its CHECK constraint
ALTER TABLE "batches"
  ADD COLUMN "days" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "class_time" TEXT,
  ADD COLUMN "description" TEXT,
  ADD CONSTRAINT "batch_class_time_valid" CHECK ("class_time" IS NULL OR "class_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "batch_days_valid" CHECK ("days" <@ ARRAY['MON','TUE','WED','THU','FRI','SAT','SUN']::text[]);

UPDATE "batches" SET "status" = 'OPEN' WHERE "status" = 'FULL';
ALTER TYPE "BatchStatus" RENAME TO "BatchStatus_old";
CREATE TYPE "BatchStatus" AS ENUM ('DRAFT', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ARCHIVED');
ALTER TABLE "batches" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "batches" ALTER COLUMN "status" TYPE "BatchStatus" USING "status"::text::"BatchStatus";
ALTER TABLE "batches" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "BatchStatus_old";

-- ── Seat holds only existed to protect capacity ────────────────────────────
DROP TABLE "seat_reservations";
DROP TYPE "ReservationStatus";

-- ── One course ─────────────────────────────────────────────────────────────
-- Financial rows reference courses, so older courses are archived + soft-deleted, not removed.
UPDATE "courses" SET "status" = 'ARCHIVED', "deleted_at" = COALESCE("deleted_at", now()) WHERE "deleted_at" IS NULL;
ALTER TABLE "courses" DROP COLUMN "entry_band_min", DROP COLUMN "entry_band_max", DROP COLUMN "target_band";
CREATE UNIQUE INDEX "courses_single_live" ON "courses" ((1)) WHERE "deleted_at" IS NULL AND "status" <> 'ARCHIVED';

-- ── Registration + payment details ─────────────────────────────────────────
ALTER TABLE "student_profiles" ADD COLUMN "city" TEXT;
ALTER TABLE "payment_proofs"
  ADD COLUMN "payment_method" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
  ADD CONSTRAINT "payment_method_valid" CHECK ("payment_method" IN ('BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA', 'OTHER'));
ALTER TABLE "payment_proofs" ALTER COLUMN "sender_bank" DROP NOT NULL;

-- ── Settings ───────────────────────────────────────────────────────────────
INSERT INTO "settings" ("key", "value", "updated_at")
SELECT 'payment.methods',
       jsonb_build_array(jsonb_build_object(
         'method', 'BANK_TRANSFER', 'enabled', true,
         'accountTitle', COALESCE("value"->>'accountTitle', ''), 'accountNumber', COALESCE("value"->>'accountNumber', ''),
         'bankName', COALESCE("value"->>'bankName', ''), 'iban', COALESCE("value"->>'iban', ''), 'instructions', COALESCE("value"->>'instructions', ''))),
       now()
FROM "settings" WHERE "key" = 'payment.bank_details'
ON CONFLICT ("key") DO NOTHING;
DELETE FROM "settings" WHERE "key" IN ('payment.bank_details', 'payment.proof_upload_window_hours', 'payment.review_hold_hours', 'commerce.purchase_policy', 'recommendation.rules');
