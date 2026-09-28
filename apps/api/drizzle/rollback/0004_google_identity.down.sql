-- Reverse of 0004_google_identity.sql. DESTRUCTIVE: drops user_identities, so every Google link is
-- lost (including those of accounts that also have a password), drops oauth_states (flows in
-- progress fail), and deletes the auth_attempts rows of kind google_start_ip. It then restores
-- NOT NULL on users.password_hash, which fails while any password-less (Google-created) user
-- exists; nothing is changed in that case. Such users must be given a password or deleted first,
-- under an explicit plan.
-- Rollback plan: run this script, then revert the commit that added the migration. Apply it before
-- 0003_outbox_retry.down.sql when rolling back further (newest first).
-- Run it as a whole (psql -1 -f) so it applies atomically, with the API and the email worker
-- stopped: a running API can insert google_start_ip rows or Google links mid-script and abort it.

DELETE FROM "auth_attempts" WHERE "kind" = 'google_start_ip';
ALTER TABLE "auth_attempts" DROP CONSTRAINT IF EXISTS "auth_attempts_kind_check";
ALTER TABLE "auth_attempts" ADD CONSTRAINT "auth_attempts_kind_check" CHECK ("auth_attempts"."kind" in ('sign_in_account', 'sign_in_ip', 'register_ip', 'reset_ip', 'reset_email', 'resend_account'));
DROP TABLE IF EXISTS "oauth_states";
DROP TABLE IF EXISTS "user_identities";
ALTER TABLE "users" ALTER COLUMN "password_hash" SET NOT NULL;

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0004_google_identity.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790635811505;
