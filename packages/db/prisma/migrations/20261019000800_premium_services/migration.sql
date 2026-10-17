-- Phase 6 of the four-tier plan initiative: Premium-only coaching services (consultancy,
-- scholarship guidance, career counseling, the sports benefit) and student booking requests.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS "premium_services" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"         TEXT NOT NULL,
  "description"  TEXT,
  "service_type" TEXT NOT NULL,
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "premium_services_type_valid" CHECK ("service_type" IN ('CONSULTANCY', 'SCHOLARSHIP_GUIDANCE', 'CAREER_COUNSELING', 'SPORTS_BENEFIT'))
);
ALTER TABLE "premium_services" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "premium_service_bookings" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "service_id"   UUID NOT NULL REFERENCES "premium_services" ("id"),
  "student_id"   UUID NOT NULL REFERENCES "student_profiles" ("id"),
  "status"       TEXT NOT NULL DEFAULT 'REQUESTED',
  "scheduled_at" TIMESTAMP(3),
  "notes"        TEXT,
  "admin_notes"  TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "premium_bookings_status_valid" CHECK ("status" IN ('REQUESTED', 'SCHEDULED', 'COMPLETED', 'CANCELLED'))
);
CREATE INDEX IF NOT EXISTS "premium_bookings_student_idx" ON "premium_service_bookings" ("student_id");
CREATE INDEX IF NOT EXISTS "premium_bookings_service_idx" ON "premium_service_bookings" ("service_id");
ALTER TABLE "premium_service_bookings" ENABLE ROW LEVEL SECURITY;

-- Seed the four baseline Premium services so the admin screen has something to configure from.
INSERT INTO "premium_services" ("name", "description", "service_type") VALUES
  ('Foreign University Consultancy', 'One-on-one guidance on applying to universities abroad.', 'CONSULTANCY'),
  ('International Scholarship Guidance', 'Help finding and applying for scholarships.', 'SCHOLARSHIP_GUIDANCE'),
  ('Career Counseling', 'Career-path guidance sessions with academy staff.', 'CAREER_COUNSELING'),
  ('Sports Benefit', 'The two-month sports-related Premium benefit.', 'SPORTS_BENEFIT')
ON CONFLICT DO NOTHING;
