-- Phase 7: teacher-authored assessments. Null = admin-owned (every existing row keeps this
-- meaning); set only for assessments created through the new mentor/assessments routes.
ALTER TABLE "assessments" ADD COLUMN "created_by_mentor_id" UUID;
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_created_by_mentor_id_fkey" FOREIGN KEY ("created_by_mentor_id") REFERENCES "mentor_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
