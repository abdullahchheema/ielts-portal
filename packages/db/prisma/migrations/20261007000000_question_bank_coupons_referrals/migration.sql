-- Question bank, coupon lifecycle and referrals. Additive: no existing row changes meaning.
-- Hand-written; applied with `prisma migrate deploy` only.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

-- ── Question bank ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "question_sets" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "title"            TEXT NOT NULL,
  "skill"            TEXT NOT NULL,
  "module"           TEXT NOT NULL DEFAULT 'ACADEMIC',
  "section_number"   INTEGER,
  "topic"            TEXT,
  "difficulty"       INTEGER NOT NULL DEFAULT 3,
  "band_target"      DECIMAL(3,1),
  "tags"             TEXT[] NOT NULL DEFAULT '{}',
  "source"           TEXT,
  "time_estimate_min" INTEGER,
  "status"           TEXT NOT NULL DEFAULT 'DRAFT',
  "student_facing"   BOOLEAN NOT NULL DEFAULT FALSE,
  "version"          INTEGER NOT NULL DEFAULT 1,
  "stimulus"         JSONB,
  "created_by"       UUID REFERENCES "users" ("id"),
  "published_at"     TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "question_sets_skill_valid" CHECK ("skill" IN ('LISTENING', 'READING', 'WRITING', 'SPEAKING')),
  CONSTRAINT "question_sets_module_valid" CHECK ("module" IN ('ACADEMIC', 'GENERAL', 'BOTH')),
  CONSTRAINT "question_sets_section_valid" CHECK ("section_number" IS NULL OR "section_number" BETWEEN 1 AND 4),
  CONSTRAINT "question_sets_difficulty_valid" CHECK ("difficulty" BETWEEN 1 AND 5),
  CONSTRAINT "question_sets_band_valid" CHECK ("band_target" IS NULL OR ("band_target" BETWEEN 0 AND 9 AND "band_target" * 2 = floor("band_target" * 2))),
  CONSTRAINT "question_sets_time_valid" CHECK ("time_estimate_min" IS NULL OR "time_estimate_min" BETWEEN 1 AND 180),
  CONSTRAINT "question_sets_status_valid" CHECK ("status" IN ('DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED')),
  CONSTRAINT "question_sets_student_facing_needs_publish" CHECK (NOT "student_facing" OR "status" = 'PUBLISHED')
);
CREATE INDEX IF NOT EXISTS "question_sets_pick_idx" ON "question_sets" ("skill", "status", "student_facing", "difficulty");
CREATE INDEX IF NOT EXISTS "question_sets_topic_idx" ON "question_sets" ("topic");
ALTER TABLE "question_sets" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "question_set_id" UUID REFERENCES "question_sets" ("id"),
  ADD COLUMN IF NOT EXISTS "ielts_type" TEXT,
  ADD COLUMN IF NOT EXISTS "source_question_id" UUID REFERENCES "questions" ("id");
DO $$ BEGIN
  ALTER TABLE "questions" ADD CONSTRAINT "questions_ielts_type_valid" CHECK ("ielts_type" IS NULL OR "ielts_type" IN (
    'MCQ_SINGLE', 'MCQ_MULTI', 'TFNG', 'YNNG', 'MATCHING_HEADINGS', 'MATCHING_INFORMATION', 'MATCHING_FEATURES',
    'MAP_LABELLING', 'SENTENCE_COMPLETION', 'SUMMARY_COMPLETION', 'NOTE_COMPLETION', 'TABLE_COMPLETION', 'FORM_COMPLETION',
    'WRITING_TASK1', 'WRITING_TASK2', 'SPEAKING_PART1', 'SPEAKING_PART2', 'SPEAKING_PART3'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "questions_set_idx" ON "questions" ("question_set_id");

-- Writing and speaking prompts are bank questions too, but they are not auto-graded.
DO $$ BEGIN
  ALTER TABLE "questions" ADD CONSTRAINT "questions_bank_type_valid" CHECK ("question_type" IN (
    'MCQ_SINGLE', 'MCQ_MULTI', 'TFNG', 'YNNG', 'MATCHING', 'COMPLETION', 'NONE'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Assessments: origin and personal/library visibility ─────────────────────
ALTER TABLE "assessments"
  ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS "generated_for_student_id" UUID REFERENCES "student_profiles" ("id"),
  ADD COLUMN IF NOT EXISTS "library_visible" BOOLEAN NOT NULL DEFAULT FALSE;
DO $$ BEGIN
  ALTER TABLE "assessments" ADD CONSTRAINT "assessments_origin_valid" CHECK ("origin" IN ('MANUAL', 'BANK', 'ADAPTIVE'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  -- A personal assessment belongs to one student and is never shared into the library.
  ALTER TABLE "assessments" ADD CONSTRAINT "assessments_personal_private" CHECK ("origin" <> 'ADAPTIVE' OR ("generated_for_student_id" IS NOT NULL AND NOT "library_visible"));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Coupons: lifecycle status and immutable discount snapshots ───────────────
ALTER TABLE "coupons"
  ADD COLUMN IF NOT EXISTS "status" TEXT,
  ADD COLUMN IF NOT EXISTS "name" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "created_by" UUID REFERENCES "users" ("id");
UPDATE "coupons" SET "status" = CASE
  WHEN NOT "active" THEN 'DISABLED'
  WHEN "expires_at" IS NOT NULL AND "expires_at" <= now() THEN 'EXPIRED'
  ELSE 'ACTIVE' END
WHERE "status" IS NULL;
ALTER TABLE "coupons" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
ALTER TABLE "coupons" ALTER COLUMN "status" SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE "coupons" ADD CONSTRAINT "coupons_status_valid" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'EXPIRED', 'DISABLED'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "coupon_redemptions"
  ADD COLUMN IF NOT EXISTS "discount_amount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "code_snapshot" TEXT;
DO $$ BEGIN
  ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_discount_nonneg" CHECK ("discount_amount" IS NULL OR "discount_amount" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Referrals ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "referral_codes" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL UNIQUE REFERENCES "student_profiles" ("id"),
  "code"       TEXT NOT NULL UNIQUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referral_codes_format_valid" CHECK ("code" ~ '^[A-Z0-9]{6,12}$')
);
ALTER TABLE "referral_codes" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "referral_clicks" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"       TEXT NOT NULL,
  "ip_hash"    TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "referral_clicks_code_created_idx" ON "referral_clicks" ("code", "created_at");
ALTER TABLE "referral_clicks" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "referrals" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "referrer_student_id" UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "referred_user_id"    UUID NOT NULL UNIQUE REFERENCES "users" ("id"),
  "referred_student_id" UUID UNIQUE REFERENCES "student_profiles" ("id"),
  "code"                TEXT NOT NULL,
  "status"              TEXT NOT NULL DEFAULT 'REGISTERED',
  "order_id"            UUID REFERENCES "orders" ("id"),
  "reward_type"         TEXT,
  "reward_amount"       DECIMAL(12,2),
  "reward_coupon_id"    UUID REFERENCES "coupons" ("id"),
  "decided_by"          UUID REFERENCES "users" ("id"),
  "decided_at"          TIMESTAMP(3),
  "enrolled_at"         TIMESTAMP(3),
  "qualified_at"        TIMESTAMP(3),
  "rewarded_at"         TIMESTAMP(3),
  "rejected_reason"     TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referrals_status_valid" CHECK ("status" IN ('REGISTERED', 'APPLIED', 'ENROLLED', 'QUALIFIED', 'REWARDED', 'REJECTED')),
  CONSTRAINT "referrals_not_self" CHECK ("referrer_student_id" <> "referred_student_id")
);
CREATE INDEX IF NOT EXISTS "referrals_referrer_status_idx" ON "referrals" ("referrer_student_id", "status");
CREATE INDEX IF NOT EXISTS "referrals_status_updated_idx" ON "referrals" ("status", "updated_at");
ALTER TABLE "referrals" ENABLE ROW LEVEL SECURITY;

-- Credits are append-only; a balance is the sum of a student's rows.
CREATE TABLE IF NOT EXISTS "account_credit_ledger" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id"  UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "referral_id" UUID REFERENCES "referrals" ("id"),
  "type"        TEXT NOT NULL,
  "amount"      DECIMAL(12,2) NOT NULL,
  "reason"      TEXT NOT NULL,
  "created_by"  UUID REFERENCES "users" ("id"),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_credit_type_valid" CHECK ("type" IN ('REFERRAL_REWARD', 'ADJUSTMENT')),
  CONSTRAINT "account_credit_reward_positive" CHECK ("type" <> 'REFERRAL_REWARD' OR "amount" > 0)
);
CREATE INDEX IF NOT EXISTS "account_credit_student_idx" ON "account_credit_ledger" ("student_id");
-- A referral can be rewarded with account credit at most once.
CREATE UNIQUE INDEX IF NOT EXISTS "account_credit_one_reward_per_referral" ON "account_credit_ledger" ("referral_id") WHERE "type" = 'REFERRAL_REWARD';
ALTER TABLE "account_credit_ledger" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE TRIGGER "account_credit_ledger_immutable"
    BEFORE UPDATE OR DELETE ON "account_credit_ledger"
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Permissions for the new surfaces (question.manage and referral.manage already exist) ──
