-- Reverse of 0011_account_include_in_available.sql. DESTRUCTIVE: drops accounts.include_in_available,
-- so every choice users made about which accounts count as available is lost; re-applying the
-- migration restores only the type defaults.
-- Rollback plan: run this script, then revert the commit that added the migration. It is the
-- newest migration (highest journal `when`), so run it BEFORE the rollback of any other migration
-- (0007_profile_display_name.down.sql, 0006_accounts.down.sql and older): the drizzle migrator only
-- applies journal entries above the highest stored `created_at`, so a leftover 0011 row would
-- silently stop older migrations from re-applying.
-- Run it as a whole (psql -1 -f) so it applies atomically, with the API stopped: a running API can
-- insert accounts mid-script.

ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "accounts_credit_card_not_available_check";
ALTER TABLE "accounts" DROP COLUMN IF EXISTS "include_in_available";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0011_account_include_in_available.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790943616052;
