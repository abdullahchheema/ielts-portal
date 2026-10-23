-- Free-test claims are now fully anonymous: no email/phone is collected, so the dedup unique
-- constraint on normalized email+phone no longer applies, and all four columns become optional.
-- Existing rows (pre-anonymous-rework leads) keep their values; only new rows will have nulls here.
DROP INDEX "free_leads_identity_unique";

ALTER TABLE "free_assessment_leads"
  ALTER COLUMN "email" DROP NOT NULL,
  ALTER COLUMN "phone" DROP NOT NULL,
  ALTER COLUMN "email_normalized" DROP NOT NULL,
  ALTER COLUMN "phone_normalized" DROP NOT NULL;
