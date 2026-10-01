-- Student IELTS history, richer teacher profiles via applications, notification destinations.

-- ── Student IELTS history: distinguish "never taken" from an actual score ──
ALTER TABLE "student_profiles"
  ADD COLUMN "ielts_history" TEXT,
  ADD COLUMN "ielts_overall" DECIMAL(3,1),
  ADD COLUMN "ielts_listening" DECIMAL(3,1),
  ADD COLUMN "ielts_reading" DECIMAL(3,1),
  ADD COLUMN "ielts_writing" DECIMAL(3,1),
  ADD COLUMN "ielts_speaking" DECIMAL(3,1),
  ADD COLUMN "ielts_test_date" DATE,
  ADD COLUMN "ielts_attempts" INTEGER,
  ADD COLUMN "father_name" TEXT,
  ADD COLUMN "date_of_birth" DATE,
  ADD COLUMN "gender" TEXT,
  ADD COLUMN "notes" TEXT;

-- Backfill from the existing current_band column.
UPDATE "student_profiles" SET
  "ielts_history" = 'TAKEN',
  "ielts_overall" = "current_band"
WHERE "current_band" IS NOT NULL;

UPDATE "student_profiles" SET "ielts_history" = 'NEVER' WHERE "ielts_history" IS NULL;

ALTER TABLE "student_profiles"
  ADD CONSTRAINT "student_ielts_history_valid" CHECK ("ielts_history" IN ('NEVER', 'TAKEN')),
  ADD CONSTRAINT "student_ielts_never_has_no_scores" CHECK (
    "ielts_history" = 'TAKEN' OR (
      "ielts_overall" IS NULL AND "ielts_listening" IS NULL AND "ielts_reading" IS NULL AND
      "ielts_writing" IS NULL AND "ielts_speaking" IS NULL AND "ielts_test_date" IS NULL AND "ielts_attempts" IS NULL
    )
  ),
  ADD CONSTRAINT "student_ielts_overall_valid"   CHECK ("ielts_overall"   IS NULL OR ("ielts_overall"   BETWEEN 0 AND 9 AND "ielts_overall"   * 2 = floor("ielts_overall"   * 2))),
  ADD CONSTRAINT "student_ielts_listening_valid" CHECK ("ielts_listening" IS NULL OR ("ielts_listening" BETWEEN 0 AND 9 AND "ielts_listening" * 2 = floor("ielts_listening" * 2))),
  ADD CONSTRAINT "student_ielts_reading_valid"   CHECK ("ielts_reading"   IS NULL OR ("ielts_reading"   BETWEEN 0 AND 9 AND "ielts_reading"   * 2 = floor("ielts_reading"   * 2))),
  ADD CONSTRAINT "student_ielts_writing_valid"   CHECK ("ielts_writing"   IS NULL OR ("ielts_writing"   BETWEEN 0 AND 9 AND "ielts_writing"   * 2 = floor("ielts_writing"   * 2))),
  ADD CONSTRAINT "student_ielts_speaking_valid"  CHECK ("ielts_speaking"  IS NULL OR ("ielts_speaking"  BETWEEN 0 AND 9 AND "ielts_speaking"  * 2 = floor("ielts_speaking"  * 2))),
  ADD CONSTRAINT "student_ielts_attempts_valid"  CHECK ("ielts_attempts"  IS NULL OR "ielts_attempts" >= 1);

-- ── Notifications: carry a destination so clicking one can navigate ────────
ALTER TABLE "notifications"
  ADD COLUMN "entity_type" TEXT,
  ADD COLUMN "entity_id" UUID,
  ADD COLUMN "link" TEXT;

-- ── Teacher applications: a job-application-level profile for teachers ─────
CREATE TABLE "teacher_applications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "full_name" TEXT NOT NULL,
  "father_name" TEXT,
  "date_of_birth" DATE,
  "gender" TEXT,
  "nationality" TEXT,
  "id_number" TEXT,
  "marital_status" TEXT,
  "phone" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "current_address" TEXT,
  "permanent_address" TEXT,
  "city" TEXT,
  "emergency_name" TEXT,
  "emergency_relation" TEXT,
  "emergency_phone" TEXT,
  "subjects" TEXT[] NOT NULL DEFAULT '{}',
  "ielts_modules" TEXT[] NOT NULL DEFAULT '{}',
  "teaching_years" DECIMAL(4,1),
  "ielts_years" DECIMAL(4,1),
  "other_english_years" DECIMAL(4,1),
  "levels_taught" TEXT,
  "online_experience" BOOLEAN,
  "in_person_experience" BOOLEAN,
  "preferred_mode" TEXT,
  "languages" TEXT[] NOT NULL DEFAULT '{}',
  "available_days" TEXT[] NOT NULL DEFAULT '{}',
  "available_time" TEXT,
  "employment_type" TEXT,
  "working_hours" TEXT,
  "joining_date" DATE,
  "notice_period" TEXT,
  "expected_salary" DECIMAL(12,2),
  "expected_hourly_rate" DECIMAL(12,2),
  "skills" TEXT[] NOT NULL DEFAULT '{}',
  "achievements" TEXT,
  "publications" TEXT,
  "memberships" TEXT,
  "personal_statement" TEXT,
  "notes" TEXT,
  "internal_notes" TEXT,
  "rejection_reason" TEXT,
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMP(3),
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "teacher_applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "teacher_application_status_valid" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED'))
);
CREATE INDEX "teacher_applications_status_submitted_at_idx" ON "teacher_applications" ("status", "submitted_at");

CREATE TABLE "teacher_educations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "application_id" UUID NOT NULL,
  "degree" TEXT NOT NULL,
  "field" TEXT,
  "institution" TEXT NOT NULL,
  "country" TEXT,
  "start_year" INTEGER,
  "end_year" INTEGER,
  "grade" TEXT,
  CONSTRAINT "teacher_educations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "teacher_educations_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "teacher_applications"("id") ON DELETE CASCADE
);
CREATE INDEX "teacher_educations_application_id_idx" ON "teacher_educations" ("application_id");

CREATE TABLE "teacher_experiences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "application_id" UUID NOT NULL,
  "organization" TEXT NOT NULL,
  "job_title" TEXT NOT NULL,
  "employment_type" TEXT,
  "start_date" DATE,
  "end_date" DATE,
  "current" BOOLEAN NOT NULL DEFAULT false,
  "responsibilities" TEXT,
  "reason_for_leaving" TEXT,
  CONSTRAINT "teacher_experiences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "teacher_experiences_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "teacher_applications"("id") ON DELETE CASCADE
);
CREATE INDEX "teacher_experiences_application_id_idx" ON "teacher_experiences" ("application_id");

CREATE TABLE "teacher_certifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "application_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "issuer" TEXT,
  "issued_at" DATE,
  "expires_at" DATE,
  CONSTRAINT "teacher_certifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "teacher_certifications_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "teacher_applications"("id") ON DELETE CASCADE
);
CREATE INDEX "teacher_certifications_application_id_idx" ON "teacher_certifications" ("application_id");

CREATE TABLE "teacher_references" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "application_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "organization" TEXT,
  "position" TEXT,
  "relationship" TEXT,
  "phone" TEXT,
  "email" TEXT,
  CONSTRAINT "teacher_references_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "teacher_references_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "teacher_applications"("id") ON DELETE CASCADE
);
CREATE INDEX "teacher_references_application_id_idx" ON "teacher_references" ("application_id");

CREATE TABLE "teacher_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "application_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "label" TEXT,
  "file_key" TEXT NOT NULL,
  "file_mime" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "teacher_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "teacher_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "teacher_applications"("id") ON DELETE CASCADE
);
CREATE INDEX "teacher_documents_application_id_idx" ON "teacher_documents" ("application_id");

-- ── Mentor profiles link back to the application that created them ─────────
ALTER TABLE "mentor_profiles" ADD COLUMN "application_id" UUID;
ALTER TABLE "mentor_profiles" ADD CONSTRAINT "mentor_profiles_application_id_key" UNIQUE ("application_id");
ALTER TABLE "mentor_profiles" ADD CONSTRAINT "mentor_profiles_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "teacher_applications"("id") ON DELETE SET NULL;

-- Every existing teacher gets an approved application record, so the admin
-- teacher detail view and the Applications tab have one source of truth.
INSERT INTO "teacher_applications" ("id", "status", "full_name", "phone", "email", "submitted_at", "updated_at", "reviewed_at")
SELECT gen_random_uuid(), 'APPROVED', mp."display_name", COALESCE(u."phone", ''), u."email", mp."created_at", mp."created_at", mp."created_at"
FROM "mentor_profiles" mp JOIN "users" u ON u."id" = mp."user_id";

UPDATE "mentor_profiles" mp SET "application_id" = ta."id"
FROM "teacher_applications" ta, "users" u
WHERE mp."user_id" = u."id" AND ta."email" = u."email" AND ta."full_name" = mp."display_name" AND mp."application_id" IS NULL;
