-- Reverse of 0003_outbox_retry.sql. Drops email_outbox.next_attempt_at: pending rows lose their
-- retry schedule and become due at once; no row is deleted. Restores the pending-rows index on
-- sent_at that 0000_identity created. The worker code of that commit must be reverted with it,
-- because it reads next_attempt_at.
-- Rollback plan: run this script, then revert the commit that added the migration. Apply it before
-- 0002_credentials_version.down.sql when rolling back further (newest first).
-- Run it as a whole (psql -1 -f) so it applies atomically.

DROP INDEX IF EXISTS "email_outbox_pending_idx";
ALTER TABLE "email_outbox" DROP COLUMN IF EXISTS "next_attempt_at";
CREATE INDEX "email_outbox_pending_idx" ON "email_outbox" USING btree ("sent_at") WHERE "email_outbox"."sent_at" is null;

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0003_outbox_retry.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790624808989;
