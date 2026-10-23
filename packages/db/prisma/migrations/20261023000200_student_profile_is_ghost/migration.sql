-- AlterTable
ALTER TABLE "student_profiles" ADD COLUMN     "is_ghost" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: flag free-test ghost accounts created before this column existed, so they're excluded
-- from admin student views/counts retroactively, not just going forward.
UPDATE "student_profiles"
SET "is_ghost" = true
FROM "users"
WHERE "users"."id" = "student_profiles"."user_id"
  AND "users"."email" LIKE 'freelead-%@free-lead.internal';
