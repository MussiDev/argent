-- Reverse of 0006_accounts.sql. DESTRUCTIVE: drops the accounts table, so EVERY account of EVERY
-- user is lost (opening balances, names, archived state); there is no way back except a backup.
-- Rollback plan: take a backup, run this script, then revert the commit that added the migration.
-- Apply it BEFORE 0005_two_factor.down.sql when rolling back further (newest first).
-- Run 0011_account_include_in_available.down.sql (and 0007) before this script: 0011 alters this table
-- and its rollback fails once the table is gone, leaving the 0011 journal row behind.
-- Run it as a whole (psql -1 -f) so it applies atomically, with the API stopped: a running API can
-- insert accounts mid-script. If a later migration added a table that references accounts (the
-- movements table of PRD 03), roll that one back first, or the DROP TABLE fails.

DROP TRIGGER IF EXISTS "accounts_immutable_fields_trigger" ON "accounts";
DROP FUNCTION IF EXISTS "accounts_immutable_fields"();
DROP TABLE IF EXISTS "accounts";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0006_accounts.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790895423195;
