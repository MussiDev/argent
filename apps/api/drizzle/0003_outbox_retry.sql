DROP INDEX "email_outbox_pending_idx";--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "email_outbox_pending_idx" ON "email_outbox" USING btree ("created_at") WHERE "email_outbox"."sent_at" is null;