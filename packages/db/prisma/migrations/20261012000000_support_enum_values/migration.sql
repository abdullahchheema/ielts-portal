-- New ticket status and categories for support automation. Enum values go in their own migration because
-- PostgreSQL cannot use a new enum value in the same transaction that adds it.

ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'ASSIGNED';
ALTER TYPE "TicketCategory" ADD VALUE IF NOT EXISTS 'ENROLLMENT';
ALTER TYPE "TicketCategory" ADD VALUE IF NOT EXISTS 'CERTIFICATE';
