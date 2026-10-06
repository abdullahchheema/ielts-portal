-- Checkout credit. Additive: the amount of account credit a student spent on an order. Existing orders are 0.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "credit_applied" NUMERIC(12, 2) NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_credit_applied_nonneg" CHECK ("credit_applied" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
