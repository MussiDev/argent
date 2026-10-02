-- Reverse of 0010_account_deletion.sql. DESTRUCTIVE: deletes every `delete_account` OAuth state
-- (a Google re-authentication in progress fails and must be started again), drops deletion_grants
-- (every pending deletion grant is lost, so a user who re-authenticated must do it again), and
-- drops the purpose, user_id and session_family_id columns of oauth_states with their checks.
-- Sign-in states and users are kept. Accounts that were already deleted stay deleted.
-- Rollback plan: run this script, then revert the commit that added the migration. It is the
-- newest migration (the newest journal `when`), so run it before 0007_profile_display_name.down.sql
-- and 0006_accounts.down.sql when rolling back further.
-- Run it as a whole (psql -1 -f) so it applies atomically, with the API and the email worker
-- stopped: a running API can insert states or grants mid-script and abort it.

DELETE FROM "oauth_states" WHERE "purpose" = 'delete_account';
DROP INDEX IF EXISTS "email_outbox_to_email_idx";
DROP INDEX IF EXISTS "email_outbox_payload_user_id_idx";
DROP TABLE IF EXISTS "deletion_grants";
ALTER TABLE "oauth_states" DROP CONSTRAINT IF EXISTS "oauth_states_sign_in_unbound_check";
ALTER TABLE "oauth_states" DROP CONSTRAINT IF EXISTS "oauth_states_delete_account_binding_check";
ALTER TABLE "oauth_states" DROP CONSTRAINT IF EXISTS "oauth_states_purpose_check";
ALTER TABLE "oauth_states" DROP CONSTRAINT IF EXISTS "oauth_states_user_id_users_id_fk";
ALTER TABLE "oauth_states" DROP COLUMN IF EXISTS "session_family_id";
ALTER TABLE "oauth_states" DROP COLUMN IF EXISTS "user_id";
ALTER TABLE "oauth_states" DROP COLUMN IF EXISTS "purpose";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0010_account_deletion.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790943164350;
