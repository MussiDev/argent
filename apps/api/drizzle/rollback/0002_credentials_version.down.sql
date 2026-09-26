-- Reverse of 0002_credentials_version.sql. Drops three columns: the credentials versions and the
-- time of the last password change are lost; passwords, users and sessions are kept. After it,
-- sessions are no longer invalidated by a version check, only by `revoked_at`.
-- Rollback plan: run this script, then revert the commit that added the migration. Apply it before
-- 0001_outbox_hardening.down.sql when rolling back further (newest first).
-- Run it as a whole (psql -1 -f) so it applies atomically.

ALTER TABLE "sessions" DROP COLUMN IF EXISTS "credentials_version";
ALTER TABLE "users" DROP COLUMN IF EXISTS "credentials_version";
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_changed_at";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0002_credentials_version.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790451538082;
