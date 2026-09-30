-- Reminders are de-duplicated per user; certificates for completed courses.
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" TEXT;
CREATE UNIQUE INDEX "notifications_user_dedupe_key" ON "notifications"("user_id", "dedupe_key") WHERE "dedupe_key" IS NOT NULL;

CREATE TABLE "certificates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "enrollment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "student_name" TEXT NOT NULL,
    "course_title" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "certificates_enrollment_id_key" ON "certificates"("enrollment_id");
CREATE UNIQUE INDEX "certificates_code_key" ON "certificates"("code");
CREATE INDEX "certificates_student_id_idx" ON "certificates"("student_id");
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "certificates" ENABLE ROW LEVEL SECURITY;
-- An issued certificate is a record: it may be revoked by status of the enrollment, never edited or deleted.
CREATE TRIGGER "certificates_immutable" BEFORE UPDATE OR DELETE ON "certificates" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
