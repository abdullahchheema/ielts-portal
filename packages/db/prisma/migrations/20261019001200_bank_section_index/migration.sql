SET lock_timeout = '3s';
SET statement_timeout = '120s';

ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "bank_section_index" INTEGER;
