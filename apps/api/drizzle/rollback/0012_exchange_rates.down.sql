-- Reverse of 0012_exchange_rates.sql. DESTRUCTIVE: drops the three exchange-rate tables, so the
-- stored rates, the refresh schedule and the refresh failure records are lost. That is harmless
-- because the next refresh rebuilds the rates, but nothing reads rates until it succeeds.
-- Rollback plan: stop the exchange-rates worker FIRST (a running worker would claim and write to
-- tables that are being dropped), run this script, then revert the commit that added the migration.
-- Apply it BEFORE the rollback of any older migration (newest `when` first): its journal `when` is
-- the greatest, and drizzle only applies migrations newer than the last recorded.
-- Run it as a whole (psql -1 -f) so it applies atomically.

DROP INDEX IF EXISTS "exchange_rate_refresh_failures_failed_at_idx";
DROP TABLE IF EXISTS "exchange_rate_refresh_failures";
DROP TABLE IF EXISTS "exchange_rate_sync";
DROP TABLE IF EXISTS "exchange_rates";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0012_exchange_rates.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790945403578;
