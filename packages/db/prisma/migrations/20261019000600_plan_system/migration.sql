-- Phase 3 of the four-tier plan initiative: the Plan/PlanEntitlement/StudentPlan model, seeded
-- with the four tiers and their feature entitlements, plus a one-time migration of every existing
-- enrolled student onto PREMIUM (they paid for the full course under the old single-price model).

SET lock_timeout = '3s';
SET statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS "plans" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"           TEXT NOT NULL UNIQUE,
  "display_name"   TEXT NOT NULL,
  "description"    TEXT,
  "price"          DECIMAL(12,2) NOT NULL DEFAULT 0,
  "currency"       TEXT NOT NULL DEFAULT 'PKR',
  "billing_period" TEXT NOT NULL DEFAULT 'ONE_TIME',
  "duration_days"  INTEGER,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "sort_order"     INTEGER NOT NULL DEFAULT 0,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plans_name_valid" CHECK ("name" IN ('FREE', 'STARTER', 'ADVANCED', 'PREMIUM')),
  CONSTRAINT "plans_billing_period_valid" CHECK ("billing_period" IN ('ONE_TIME', 'MONTHLY', 'YEARLY'))
);
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "plan_entitlements" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "plan_id"     UUID NOT NULL REFERENCES "plans" ("id") ON DELETE CASCADE,
  "feature_key" TEXT NOT NULL,
  "value"       JSONB NOT NULL DEFAULT 'true',
  "description" TEXT,
  CONSTRAINT "plan_entitlements_unique" UNIQUE ("plan_id", "feature_key")
);
CREATE INDEX IF NOT EXISTS "plan_entitlements_feature_idx" ON "plan_entitlements" ("feature_key");
ALTER TABLE "plan_entitlements" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "student_plans" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "plan_id"    UUID NOT NULL REFERENCES "plans" ("id"),
  "status"     TEXT NOT NULL DEFAULT 'ACTIVE',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  "order_id"   UUID REFERENCES "orders" ("id") ON DELETE SET NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_plans_status_valid" CHECK ("status" IN ('ACTIVE', 'EXPIRED', 'CANCELLED', 'UPGRADED'))
);
-- Only one active plan per student at a time.
CREATE UNIQUE INDEX IF NOT EXISTS "student_plans_one_active" ON "student_plans" ("student_id") WHERE ("status" = 'ACTIVE');
CREATE INDEX IF NOT EXISTS "student_plans_student_idx" ON "student_plans" ("student_id");
CREATE INDEX IF NOT EXISTS "student_plans_plan_idx" ON "student_plans" ("plan_id");
ALTER TABLE "student_plans" ENABLE ROW LEVEL SECURITY;

-- Seed the four plans. Prices are placeholders the academy must set via the admin plan screen —
-- never used as real charges until an admin confirms them.
INSERT INTO "plans" ("name", "display_name", "description", "price", "duration_days", "sort_order") VALUES
  ('FREE',     'Free',     'One diagnostic test to see where you stand.',                                     0,     NULL, 0),
  ('STARTER',  'Starter',  'Unlimited practice and mock tests with full, deterministic results.',             5000,  180,  1),
  ('ADVANCED', 'Advanced', 'Everything in Starter, plus AI-assisted writing and speaking evaluation.',         10000, 180,  2),
  ('PREMIUM',  'Premium',  'Everything in Advanced, plus live classes, a dedicated teacher and coaching.',     25000, 180,  3)
ON CONFLICT ("name") DO NOTHING;

-- Seed entitlements (feature keys the EntitlementService checks at runtime).
INSERT INTO "plan_entitlements" ("plan_id", "feature_key", "value", "description")
SELECT p."id", e.feature_key, e.value::jsonb, e.description
FROM "plans" p
JOIN (VALUES
  ('FREE',     'assessment.free_test',          'true',  'Can take the free test'),
  ('FREE',     'assessment.detailed_results',   'false', 'No per-question breakdown or answer keys'),
  ('FREE',     'ai.evaluation',                 'false', NULL),
  ('FREE',     'practice.unlimited',            'false', NULL),
  ('FREE',     'mock.unlimited',                'false', NULL),
  ('STARTER',  'assessment.detailed_results',   'true',  'Full objective results and answer keys'),
  ('STARTER',  'ai.evaluation',                 'false', NULL),
  ('STARTER',  'practice.unlimited',            'true',  NULL),
  ('STARTER',  'mock.unlimited',                'true',  NULL),
  ('STARTER',  'teacher.assignment',            'false', NULL),
  ('STARTER',  'class.access',                  'false', NULL),
  ('STARTER',  'premium.services',              'false', NULL),
  ('ADVANCED', 'assessment.detailed_results',   'true',  NULL),
  ('ADVANCED', 'ai.evaluation',                 'true',  'AI writing and speaking evaluation'),
  ('ADVANCED', 'practice.unlimited',            'true',  NULL),
  ('ADVANCED', 'mock.unlimited',                'true',  NULL),
  ('ADVANCED', 'teacher.assignment',            'false', NULL),
  ('ADVANCED', 'class.access',                  'false', NULL),
  ('ADVANCED', 'premium.services',              'false', NULL),
  ('PREMIUM',  'assessment.detailed_results',   'true',  NULL),
  ('PREMIUM',  'ai.evaluation',                 'true',  NULL),
  ('PREMIUM',  'practice.unlimited',            'true',  NULL),
  ('PREMIUM',  'mock.unlimited',                'true',  NULL),
  ('PREMIUM',  'teacher.assignment',            'true',  'Dedicated teacher/mentor assignment'),
  ('PREMIUM',  'class.access',                  'true',  'Live weekday classes'),
  ('PREMIUM',  'premium.services',              'true',  'Consultancy, scholarship and career-counseling services')
) AS e(plan_name, feature_key, value, description) ON p."name" = e.plan_name
ON CONFLICT ("plan_id", "feature_key") DO NOTHING;

-- Existing enrolled students paid under the old single-course model: treat that as PREMIUM so
-- nobody loses access they already paid for. New students go through the plan-selecting enrollment flow.
INSERT INTO "student_plans" ("student_id", "plan_id", "status", "started_at")
SELECT DISTINCT e."student_id", p."id", 'ACTIVE', COALESCE(e."enrolled_at", e."created_at")
FROM "enrollments" e
JOIN "plans" p ON p."name" = 'PREMIUM'
WHERE e."status" IN ('ACTIVE', 'COMPLETED', 'PAUSED') AND e."deleted_at" IS NULL
ON CONFLICT DO NOTHING;
