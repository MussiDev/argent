-- Reverse of 0005_two_factor.sql. DESTRUCTIVE: drops user_two_factor, which turns two-factor
-- authentication OFF for every user (their TOTP secrets are lost and they sign in with one factor
-- again), drops recovery_codes (every recovery code is lost) and sign_in_challenges (sign-ins
-- waiting for their second factor fail), and deletes the auth_attempts rows of the second-factor
-- and disable kinds and the email_outbox rows of the two-factor notice kinds (unsent notices are
-- lost). Users must enroll again after the migration is re-applied.
-- Rollback plan: run this script, then revert the commit that added the migration. Apply it before
-- 0004_google_identity.down.sql when rolling back further (newest first).
-- Run it as a whole (psql -1 -f) so it applies atomically, with the API and the email worker
-- stopped: a running API can insert rows of the new kinds or challenges mid-script and abort it.

DELETE FROM "auth_attempts" WHERE "kind" IN ('second_factor_user_15m', 'second_factor_user_24h', 'two_factor_disable_user', 'two_factor_disable_user_24h');
ALTER TABLE "auth_attempts" DROP CONSTRAINT IF EXISTS "auth_attempts_kind_check";
ALTER TABLE "auth_attempts" ADD CONSTRAINT "auth_attempts_kind_check" CHECK ("auth_attempts"."kind" in ('sign_in_account', 'sign_in_ip', 'register_ip', 'reset_ip', 'reset_email', 'resend_account', 'google_start_ip'));
DELETE FROM "email_outbox" WHERE "kind" IN ('two_factor_enabled', 'two_factor_disabled');
ALTER TABLE "email_outbox" DROP CONSTRAINT IF EXISTS "email_outbox_kind_check";
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_kind_check" CHECK ("email_outbox"."kind" in ('verification', 'password_reset', 'discard'));
DROP TABLE IF EXISTS "sign_in_challenges";
DROP TABLE IF EXISTS "recovery_codes";
DROP TABLE IF EXISTS "user_two_factor";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0005_two_factor.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790810895929;
