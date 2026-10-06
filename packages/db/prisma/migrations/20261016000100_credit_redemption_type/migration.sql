-- Allowed ledger types gain REDEMPTION (credit spent at checkout). Its own migration, per the convention for value changes.

SET lock_timeout = '3s';
SET statement_timeout = '120s';

ALTER TABLE "account_credit_ledger" DROP CONSTRAINT IF EXISTS "account_credit_type_valid";
ALTER TABLE "account_credit_ledger" ADD CONSTRAINT "account_credit_type_valid"
  CHECK ("type" IN ('REFERRAL_REWARD', 'ADJUSTMENT', 'REDEMPTION'));
