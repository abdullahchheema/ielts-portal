-- Support ticket conversation + refund decision notes.
CREATE TABLE "ticket_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ticket_messages_ticket_id_created_at_idx" ON "ticket_messages"("ticket_id", "created_at");
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket_messages" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "refunds" ADD COLUMN "decision_note" TEXT;
ALTER TABLE "support_tickets" ADD CONSTRAINT "ticket_priority_valid" CHECK ("priority" IN ('LOW', 'NORMAL', 'HIGH', 'URGENT'));
CREATE INDEX "support_tickets_status_created_at_idx" ON "support_tickets"("status", "created_at");
CREATE INDEX "live_sessions_batch_id_starts_at_idx" ON "live_sessions"("batch_id", "starts_at");
