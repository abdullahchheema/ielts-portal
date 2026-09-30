-- Hand-written constraints that Prisma's schema language cannot express.

-- ── Band values: 0–9 in 0.5 steps ──────────────────────────────────────────
ALTER TABLE "student_profiles"
  ADD CONSTRAINT "student_current_band_valid" CHECK ("current_band" IS NULL OR ("current_band" BETWEEN 0 AND 9 AND "current_band" * 2 = floor("current_band" * 2))),
  ADD CONSTRAINT "student_target_band_valid"  CHECK ("target_band"  IS NULL OR ("target_band"  BETWEEN 0 AND 9 AND "target_band"  * 2 = floor("target_band"  * 2)));

ALTER TABLE "courses"
  ADD CONSTRAINT "course_entry_min_valid" CHECK ("entry_band_min" IS NULL OR ("entry_band_min" BETWEEN 0 AND 9 AND "entry_band_min" * 2 = floor("entry_band_min" * 2))),
  ADD CONSTRAINT "course_entry_max_valid" CHECK ("entry_band_max" IS NULL OR ("entry_band_max" BETWEEN 0 AND 9 AND "entry_band_max" * 2 = floor("entry_band_max" * 2))),
  ADD CONSTRAINT "course_target_valid"    CHECK ("target_band"    IS NULL OR ("target_band"    BETWEEN 0 AND 9 AND "target_band"    * 2 = floor("target_band"    * 2))),
  ADD CONSTRAINT "course_entry_order"     CHECK ("entry_band_min" IS NULL OR "entry_band_max" IS NULL OR "entry_band_min" <= "entry_band_max"),
  ADD CONSTRAINT "course_price_nonneg"    CHECK ("price" >= 0);

ALTER TABLE "assessment_attempts"
  ADD CONSTRAINT "attempt_band_valid" CHECK ("band_score" IS NULL OR ("band_score" BETWEEN 0 AND 9 AND "band_score" * 2 = floor("band_score" * 2)));

ALTER TABLE "rubric_scores"
  ADD CONSTRAINT "rubric_score_valid" CHECK ("score" BETWEEN 0 AND 9 AND "score" * 2 = floor("score" * 2));

ALTER TABLE "submission_feedback"
  ADD CONSTRAINT "feedback_band_valid" CHECK ("final_band" IS NULL OR ("final_band" BETWEEN 0 AND 9 AND "final_band" * 2 = floor("final_band" * 2)));

ALTER TABLE "band_conversion_tables"
  ADD CONSTRAINT "conversion_band_valid" CHECK ("band" BETWEEN 0 AND 9 AND "band" * 2 = floor("band" * 2)),
  ADD CONSTRAINT "conversion_range_valid" CHECK ("raw_min" <= "raw_max");

-- ── Batches / commerce sanity ──────────────────────────────────────────────
ALTER TABLE "batches"
  ADD CONSTRAINT "batch_capacity_positive" CHECK ("capacity" > 0),
  ADD CONSTRAINT "batch_dates_ordered"     CHECK ("end_at" IS NULL OR "end_at" >= "start_at");

ALTER TABLE "orders"
  ADD CONSTRAINT "order_amounts_valid" CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "tax" >= 0 AND "total" >= 0);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_item_amounts_valid" CHECK ("original_price" >= 0 AND "discount" >= 0 AND "final_price" >= 0);

ALTER TABLE "payments"     ADD CONSTRAINT "payment_amount_nonneg" CHECK ("amount" >= 0);
ALTER TABLE "refunds"      ADD CONSTRAINT "refund_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "coupons"
  ADD CONSTRAINT "coupon_value_positive"   CHECK ("value" > 0),
  ADD CONSTRAINT "coupon_percent_max"      CHECK ("discount_type" <> 'PERCENTAGE' OR "value" <= 100),
  ADD CONSTRAINT "coupon_redeemed_bounded" CHECK ("max_redemptions" IS NULL OR "redeemed_count" <= "max_redemptions");

-- ── One live enrollment per student per batch ──────────────────────────────
CREATE UNIQUE INDEX "enrollments_one_live_per_batch"
  ON "enrollments" ("student_id", "batch_id")
  WHERE "status" IN ('PENDING_PAYMENT', 'ACTIVE', 'PAUSED') AND "deleted_at" IS NULL;

-- ── One open order per student per batch (idempotent checkout) ─────────────
CREATE UNIQUE INDEX "seat_reservations_one_open_per_student_batch"
  ON "seat_reservations" ("student_id", "batch_id")
  WHERE "status" IN ('HELD', 'UNDER_REVIEW');

-- ── A bank transaction reference can only back one approved payment ────────
CREATE UNIQUE INDEX "payment_proofs_approved_txn_unique"
  ON "payment_proofs" (lower("bank_txn_reference"))
  WHERE "status" = 'APPROVED';

-- ── Refunds cannot exceed the captured payment amount ──────────────────────
CREATE OR REPLACE FUNCTION enforce_refund_cap() RETURNS trigger AS $$
DECLARE
  captured numeric;
  already  numeric;
BEGIN
  SELECT "amount" INTO captured FROM "payments" WHERE "id" = NEW."payment_id";
  SELECT COALESCE(SUM("amount"), 0) INTO already FROM "refunds"
    WHERE "payment_id" = NEW."payment_id" AND "status" <> 'REJECTED' AND "id" <> NEW."id";
  IF NEW."status" <> 'REJECTED' AND already + NEW."amount" > captured THEN
    RAISE EXCEPTION 'REFUND_NOT_ALLOWED: refunds exceed captured payment amount';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "refunds_cap_check"
  BEFORE INSERT OR UPDATE ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION enforce_refund_cap();

-- ── Immutability: audit log is append-only, financial rows cannot be deleted ─
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is not permitted', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_no_update"   BEFORE UPDATE OR DELETE ON "audit_logs"     FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "orders_no_delete"       BEFORE DELETE ON "orders"        FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "order_items_no_delete"  BEFORE DELETE ON "order_items"   FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "payments_no_delete"     BEFORE DELETE ON "payments"      FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "payment_proofs_no_delete" BEFORE DELETE ON "payment_proofs" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "payment_events_no_mutation" BEFORE UPDATE OR DELETE ON "payment_events" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "refunds_no_delete"      BEFORE DELETE ON "refunds"       FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ── Submitted attempts are frozen ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION freeze_submitted_answers() RETURNS trigger AS $$
DECLARE
  st text;
BEGIN
  SELECT "status"::text INTO st FROM "assessment_attempts" WHERE "id" = COALESCE(NEW."attempt_id", OLD."attempt_id");
  IF st NOT IN ('NOT_STARTED', 'IN_PROGRESS') THEN
    RAISE EXCEPTION 'ATTEMPT_ALREADY_SUBMITTED: answers are frozen';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "attempt_answers_freeze"
  BEFORE INSERT OR UPDATE OR DELETE ON "attempt_answers"
  FOR EACH ROW EXECUTE FUNCTION freeze_submitted_answers();
