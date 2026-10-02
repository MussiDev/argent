-- Reverse of 0013_investments.sql. DESTRUCTIVE: drops holdings and portfolios, so every portfolio
-- and holding of every user is lost (nothing else references them). Users, accounts and every
-- other table are untouched.
-- Rollback plan: run this script, then revert the commit that added the migration. Apply it before
-- 0005_two_factor.down.sql when rolling back further (newest first).
-- Run it as a whole (psql -1 -f) so it applies atomically, with the API stopped: a running API can
-- insert rows mid-script and make it wait on their locks.

DROP TABLE IF EXISTS "holdings";
DROP TABLE IF EXISTS "portfolios";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0013_investments.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790962588595;
