SET lock_timeout = '3s';
SET statement_timeout = '120s';

ALTER TABLE "question_images" ADD COLUMN IF NOT EXISTS "section_index" INTEGER;
