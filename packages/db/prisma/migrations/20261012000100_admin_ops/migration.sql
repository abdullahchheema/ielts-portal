-- Admin experience: search indexes, internal notes, knowledge for the staff and tutor assistants, and SLA columns.
-- Additive. Trigram search is enabled when the server allows it; otherwise plain indexes keep search working.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

ALTER TABLE "support_tickets"
  ADD COLUMN IF NOT EXISTS "sla_due_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "first_response_at" TIMESTAMP(3);

-- ── Search ───────────────────────────────────────────────────────────────────
-- pg_trgm makes partial matching indexable. If it cannot be created, btree indexes on lower(...) still serve
-- prefix searches, and the search service falls back to them.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm unavailable: %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "student_profiles_name_trgm" ON "student_profiles" USING gin ((lower("first_name") || ' ' || lower("last_name")) gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  CREATE INDEX IF NOT EXISTS "student_profiles_name_lower" ON "student_profiles" ((lower("first_name")), (lower("last_name")));
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "users_email_trgm" ON "users" USING gin (lower("email") gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  CREATE INDEX IF NOT EXISTS "users_email_lower" ON "users" ((lower("email")));
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "batches_name_trgm" ON "batches" USING gin (lower("name") gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  CREATE INDEX IF NOT EXISTS "batches_name_lower" ON "batches" ((lower("name")));
END $$;

CREATE INDEX IF NOT EXISTS "payment_proofs_txn_lower" ON "payment_proofs" ((lower("bank_txn_reference")));
CREATE INDEX IF NOT EXISTS "certificates_code_lower" ON "certificates" ((lower("code")));

-- ── Internal notes ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "internal_notes" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "target_type" TEXT NOT NULL,
  "target_id"   UUID NOT NULL,
  "author_id"   UUID NOT NULL REFERENCES "users" ("id"),
  "body"        TEXT NOT NULL,
  "visibility"  TEXT NOT NULL DEFAULT 'ALL_STAFF',
  "pinned"      BOOLEAN NOT NULL DEFAULT FALSE,
  "deleted_at"  TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "internal_notes_target_valid" CHECK ("target_type" IN ('STUDENT', 'TEACHER', 'BATCH', 'APPLICATION', 'PAYMENT', 'TICKET')),
  CONSTRAINT "internal_notes_visibility_valid" CHECK ("visibility" IN ('ALL_STAFF', 'ACADEMIC', 'FINANCE', 'SUPPORT')),
  CONSTRAINT "internal_notes_body_len" CHECK (char_length("body") BETWEEN 1 AND 4000)
);
CREATE INDEX IF NOT EXISTS "internal_notes_target_idx" ON "internal_notes" ("target_type", "target_id", "created_at");
ALTER TABLE "internal_notes" ENABLE ROW LEVEL SECURITY;

-- ── Knowledge for the staff and tutor assistants ─────────────────────────────
CREATE TABLE IF NOT EXISTS "knowledge_articles" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "title"        TEXT NOT NULL,
  "body"         TEXT NOT NULL,
  "audience"     TEXT NOT NULL DEFAULT 'STAFF',
  "status"       TEXT NOT NULL DEFAULT 'DRAFT',
  "updated_by"   UUID REFERENCES "users" ("id"),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_articles_audience_valid" CHECK ("audience" IN ('STAFF', 'STUDENT', 'BOTH')),
  CONSTRAINT "knowledge_articles_status_valid" CHECK ("status" IN ('DRAFT', 'APPROVED'))
);
CREATE INDEX IF NOT EXISTS "knowledge_articles_search_idx" ON "knowledge_articles" USING gin (to_tsvector('english', "title" || ' ' || "body"));
ALTER TABLE "knowledge_articles" ENABLE ROW LEVEL SECURITY;

-- ── Tutor conversations ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ai_conversations" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"     UUID NOT NULL REFERENCES "users" ("id"),
  "mode"        TEXT NOT NULL DEFAULT 'GENERAL',
  "title"       TEXT NOT NULL DEFAULT 'New chat',
  "deleted_at"  TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_conversations_mode_valid" CHECK ("mode" IN ('GENERAL', 'READING', 'WRITING', 'SPEAKING', 'GRAMMAR', 'VOCABULARY')),
  CONSTRAINT "ai_conversations_title_len" CHECK (char_length("title") BETWEEN 1 AND 120)
);
CREATE INDEX IF NOT EXISTS "ai_conversations_user_idx" ON "ai_conversations" ("user_id", "updated_at");
ALTER TABLE "ai_conversations" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "ai_messages" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL REFERENCES "ai_conversations" ("id"),
  "role"            TEXT NOT NULL,
  "content"         TEXT NOT NULL,
  "sources"         JSONB,
  "ai_request_id"   UUID REFERENCES "ai_requests" ("id"),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_messages_role_valid" CHECK ("role" IN ('USER', 'ASSISTANT')),
  CONSTRAINT "ai_messages_content_len" CHECK (char_length("content") BETWEEN 1 AND 8000)
);
CREATE INDEX IF NOT EXISTS "ai_messages_conversation_idx" ON "ai_messages" ("conversation_id", "created_at");
ALTER TABLE "ai_messages" ENABLE ROW LEVEL SECURITY;
