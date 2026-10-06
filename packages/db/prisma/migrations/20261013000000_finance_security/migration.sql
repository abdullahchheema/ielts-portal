-- Finance and security intelligence: duplicate-payment flags, statement reconciliation, certificate numbers and revocation.
-- Additive. Existing financial rows are not changed; the one backfill numbers existing certificates without touching
-- anything else, with the immutability trigger suspended only for that statement.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

-- ── Duplicate and suspicious payment detection ──────────────────────────────
ALTER TABLE "payment_proofs" ADD COLUMN IF NOT EXISTS "file_sha256" TEXT;
CREATE INDEX IF NOT EXISTS "payment_proofs_file_sha256_idx" ON "payment_proofs" ("file_sha256") WHERE "file_sha256" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "payment_risk_flags" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "payment_id"  UUID NOT NULL REFERENCES "payments" ("id"),
  "proof_id"    UUID NOT NULL REFERENCES "payment_proofs" ("id"),
  "rule"        TEXT NOT NULL,
  "level"       TEXT NOT NULL,
  "reason"      TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'OPEN',
  "reviewed_by" UUID REFERENCES "users" ("id"),
  "reviewed_at" TIMESTAMP(3),
  "review_note" TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_risk_flags_unique" UNIQUE ("proof_id", "rule"),
  CONSTRAINT "payment_risk_flags_level_valid" CHECK ("level" IN ('LOW', 'MEDIUM', 'HIGH')),
  CONSTRAINT "payment_risk_flags_status_valid" CHECK ("status" IN ('OPEN', 'DISMISSED', 'CONFIRMED'))
);
ALTER TABLE "payment_risk_flags" ENABLE ROW LEVEL SECURITY;

-- ── Statement reconciliation ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "statement_imports" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "method"      TEXT NOT NULL,
  "row_count"   INTEGER NOT NULL,
  "uploaded_by" UUID NOT NULL REFERENCES "users" ("id"),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "statement_imports_method_valid" CHECK ("method" IN ('BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA', 'OTHER')),
  CONSTRAINT "statement_imports_rows_valid" CHECK ("row_count" BETWEEN 1 AND 5000)
);
ALTER TABLE "statement_imports" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "statement_lines" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "import_id"   UUID NOT NULL REFERENCES "statement_imports" ("id"),
  "method"      TEXT NOT NULL,
  "reference"   TEXT NOT NULL,
  "amount"      DECIMAL(12,2) NOT NULL,
  "txn_date"    DATE NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "statement_lines_amount_positive" CHECK ("amount" > 0)
);
CREATE INDEX IF NOT EXISTS "statement_lines_ref_idx" ON "statement_lines" ((lower("reference")));
ALTER TABLE "statement_lines" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "payment_reconciliations" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "proof_id"          UUID NOT NULL UNIQUE REFERENCES "payment_proofs" ("id"),
  "status"            TEXT NOT NULL,
  "reasons"           TEXT[] NOT NULL DEFAULT '{}',
  "statement_line_id" UUID REFERENCES "statement_lines" ("id"),
  "resolution"        TEXT,
  "resolution_note"   TEXT,
  "resolved_by"       UUID REFERENCES "users" ("id"),
  "resolved_at"       TIMESTAMP(3),
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_reconciliations_status_valid" CHECK ("status" IN ('MATCHED', 'MISMATCHED', 'DUPLICATE', 'PENDING_REVIEW', 'UNMATCHED')),
  CONSTRAINT "payment_reconciliations_resolution_valid" CHECK ("resolution" IS NULL OR "resolution" IN ('ACCEPTED', 'REJECTED_EXCEPTION'))
);
ALTER TABLE "payment_reconciliations" ENABLE ROW LEVEL SECURITY;

-- ── Certificates: numbers, batch, revocation ────────────────────────────────
ALTER TABLE "certificates"
  ADD COLUMN IF NOT EXISTS "certificate_number" TEXT,
  ADD COLUMN IF NOT EXISTS "batch_name" TEXT;

ALTER TABLE "certificates" DISABLE TRIGGER "certificates_immutable";
UPDATE "certificates" c SET "certificate_number" = n.num
  FROM (
    SELECT id, 'IA-' || to_char(issued_at, 'YYYY') || '-' || lpad(row_number() OVER (PARTITION BY date_part('year', issued_at) ORDER BY issued_at, id)::text, 6, '0') AS num
      FROM "certificates"
  ) n
 WHERE c.id = n.id AND c."certificate_number" IS NULL;
ALTER TABLE "certificates" ENABLE TRIGGER "certificates_immutable";

DO $$ BEGIN
  ALTER TABLE "certificates" ADD CONSTRAINT "certificates_number_unique" UNIQUE ("certificate_number");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "certificate_revocations" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "certificate_id" UUID NOT NULL UNIQUE REFERENCES "certificates" ("id"),
  "reason"         TEXT NOT NULL,
  "revoked_by"     UUID NOT NULL REFERENCES "users" ("id"),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "certificate_revocations_reason_len" CHECK (char_length("reason") BETWEEN 5 AND 500)
);
ALTER TABLE "certificate_revocations" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE TRIGGER "certificate_revocations_immutable" BEFORE UPDATE OR DELETE ON "certificate_revocations"
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Permission for revoking certificates. Granted to the roles that already issue them, and super admins.
INSERT INTO "permissions" ("id", "key") VALUES (gen_random_uuid(), 'certificate.revoke') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."key" = 'certificate.revoke'
 WHERE r."name" IN ('SUPER_ADMIN', 'ACADEMIC_ADMIN')
ON CONFLICT DO NOTHING;
