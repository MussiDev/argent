-- Reverse of 0000_identity.sql. Destroys every identity table and its data.
-- Rollback plan: there is no production data yet, so reverting this schema change means running
-- this script against the database and reverting the commit that added the migration.
-- Run it as a whole (psql -1 -f) so it applies atomically.

DROP TABLE IF EXISTS "email_outbox";
DROP TABLE IF EXISTS "auth_attempts";
DROP TABLE IF EXISTS "sessions";
DROP TABLE IF EXISTS "one_time_tokens";
DROP TABLE IF EXISTS "users";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0000_identity.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790394626871;
