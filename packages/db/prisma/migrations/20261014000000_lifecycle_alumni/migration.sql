-- Student lifecycle: one current stage per student and an append-only history of every transition, with its reason.
-- Additive. Existing students are backfilled from their enrolment and application state, with the reason recorded as BACKFILL.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS "student_lifecycle" (
  "student_id"  UUID PRIMARY KEY REFERENCES "student_profiles" ("id"),
  "stage"       TEXT NOT NULL,
  "since"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_lifecycle_stage_valid" CHECK ("stage" IN (
    'REGISTERED', 'APPLICATION_STARTED', 'APPLICATION_SUBMITTED', 'PAYMENT_PENDING', 'PAYMENT_APPROVED',
    'ENROLLED', 'ACTIVE', 'AT_RISK', 'INACTIVE', 'COMPLETED', 'ALUMNI'))
);
ALTER TABLE "student_lifecycle" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "student_lifecycle_transitions" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id"  UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "from_stage"  TEXT,
  "to_stage"    TEXT NOT NULL,
  "reason"      TEXT NOT NULL,
  "source"      TEXT NOT NULL,
  "actor_id"    UUID REFERENCES "users" ("id"),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_lifecycle_transitions_source_valid" CHECK ("source" IN ('SYSTEM', 'STAFF', 'BACKFILL')),
  CONSTRAINT "student_lifecycle_transitions_reason_len" CHECK (char_length("reason") BETWEEN 3 AND 300)
);
CREATE INDEX IF NOT EXISTS "student_lifecycle_transitions_student_idx" ON "student_lifecycle_transitions" ("student_id", "created_at");
ALTER TABLE "student_lifecycle_transitions" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE TRIGGER "student_lifecycle_transitions_immutable" BEFORE UPDATE OR DELETE ON "student_lifecycle_transitions"
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill: current stage from the strongest state the student already has. Visitors are not stored.
WITH best AS (
  SELECT sp.id AS student_id,
    CASE
      WHEN EXISTS (SELECT 1 FROM "enrollments" e JOIN "certificates" c ON c."enrollment_id" = e."id" WHERE e."student_id" = sp."id" AND e."status" = 'COMPLETED') THEN 'ALUMNI'
      WHEN EXISTS (SELECT 1 FROM "enrollments" e WHERE e."student_id" = sp."id" AND e."status" = 'COMPLETED') THEN 'COMPLETED'
      WHEN EXISTS (SELECT 1 FROM "enrollments" e WHERE e."student_id" = sp."id" AND e."status" = 'ACTIVE') THEN 'ACTIVE'
      WHEN EXISTS (SELECT 1 FROM "enrollments" e WHERE e."student_id" = sp."id" AND e."status" = 'PENDING_PAYMENT') THEN 'PAYMENT_PENDING'
      WHEN EXISTS (SELECT 1 FROM "orders" o WHERE o."student_id" = sp."id" AND o."status" = 'PENDING_REVIEW') THEN 'APPLICATION_SUBMITTED'
      ELSE 'REGISTERED'
    END AS stage
  FROM "student_profiles" sp
)
INSERT INTO "student_lifecycle" ("student_id", "stage")
SELECT b.student_id, b.stage FROM best b
ON CONFLICT ("student_id") DO NOTHING;

INSERT INTO "student_lifecycle_transitions" ("student_id", "from_stage", "to_stage", "reason", "source")
SELECT l.student_id, NULL, l.stage, 'Stage inferred when lifecycle tracking started', 'BACKFILL'
  FROM "student_lifecycle" l
 WHERE NOT EXISTS (SELECT 1 FROM "student_lifecycle_transitions" t WHERE t."student_id" = l."student_id");
