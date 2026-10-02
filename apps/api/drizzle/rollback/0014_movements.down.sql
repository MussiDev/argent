-- Reverse of 0014_movements.sql. DESTRUCTIVE: drops movements and movement_rate_limits, so every
-- expense and income of every user and the creation counters are lost (nothing else references
-- them). Users, accounts, categories and every other table are untouched; the unique constraint
-- that 0014 added to accounts is removed.
-- Rollback plan: take a backup first, stop the API and the worker (a running API can insert rows
-- mid-script and make it wait on their locks), run this script, then revert the commit that added
-- the migration. Apply it BEFORE the rollback of any older migration (newest `when` first): its
-- journal `when` is the greatest, and drizzle only applies migrations newer than the last recorded.
-- Run it as a whole (psql -1 -f) so it applies atomically.

-- The relations go first: the composite key of movements depends on the unique constraint below.
DROP TABLE IF EXISTS "movement_rate_limits";
DROP TABLE IF EXISTS "movements";

-- IF EXISTS on the table too: the migration tests re-run rollbacks after `accounts` is gone.
ALTER TABLE IF EXISTS "accounts" DROP CONSTRAINT IF EXISTS "accounts_id_owner_unique";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0014_movements.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790966184307;
