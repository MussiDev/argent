-- Reverse of 0001_outbox_hardening.sql. Drops only an index and a check constraint: no data is lost.
-- Rollback plan: run this script, then revert the commit that added the migration. Apply it before
-- 0000_identity.down.sql when rolling back further (newest first).
-- Run it as a whole (psql -1 -f) so it applies atomically.

DROP INDEX IF EXISTS "auth_attempts_window_start_idx";
ALTER TABLE "email_outbox" DROP CONSTRAINT IF EXISTS "email_outbox_language_check";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0001_outbox_hardening.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790396081928;
