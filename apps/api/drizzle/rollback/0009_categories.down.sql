-- Reverse of 0009_categories.sql. DESTRUCTIVE: drops the categories table, so EVERY category of
-- EVERY user is lost (custom categories, renames, icons, colors, archived state) and drops the
-- category_defaults_seeded markers; re-applying the migration seeds the default set again for every
-- user, but nothing the users changed comes back. There is no way back except a backup.
-- Rollback plan: take a backup, run this script, then revert the commit that added the migration.
-- 0009 has the newest journal `when`, so apply it BEFORE 0007_profile_display_name.down.sql and
-- the other rollback scripts when rolling back further (newest first).
-- Run it as a whole (psql -1 -f) so it applies atomically, with the API stopped: a running API can
-- insert categories mid-script. If a later migration added a table that references categories (the
-- movements table of PRD 03), roll that one back first, or the DROP TABLE fails.

DROP TRIGGER IF EXISTS "categories_guard_trigger" ON "categories";
DROP FUNCTION IF EXISTS "categories_guard"();
DROP TABLE IF EXISTS "category_defaults_seeded";
DROP TABLE IF EXISTS "categories";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0009_categories.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790902441319;
