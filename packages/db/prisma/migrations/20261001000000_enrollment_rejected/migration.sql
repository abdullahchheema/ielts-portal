-- A new enum value cannot be used in the same transaction that adds it, so it gets its own migration.
ALTER TYPE "EnrollmentStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
