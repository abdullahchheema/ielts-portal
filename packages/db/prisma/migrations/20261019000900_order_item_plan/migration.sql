-- Phase 5 of the four-tier plan initiative: records which plan an order line item activates once
-- its payment is verified, so the enrollment flow's plan selection survives the PENDING_PAYMENT wait.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "plan_name" TEXT;
ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_plan_name_valid";
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_plan_name_valid" CHECK ("plan_name" IS NULL OR "plan_name" IN ('FREE', 'STARTER', 'ADVANCED', 'PREMIUM'));
