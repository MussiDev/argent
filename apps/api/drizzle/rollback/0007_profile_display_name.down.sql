-- Reverse of 0007_profile_display_name.sql. DESTRUCTIVE: drops users.display_name, so every
-- display name users have set is lost (accounts keep working and show no name until they set
-- one again).
-- Rollback plan: run this script, then revert the commit that added the migration. It is the
-- newest migration, so run it before 0005_two_factor.down.sql when rolling back further.
-- Run it as a whole (psql -1 -f) so it applies atomically, with the API stopped: a running API can
-- write a display name mid-script.

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_display_name_check";
ALTER TABLE "users" DROP COLUMN IF EXISTS "display_name";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0007_profile_display_name.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790891329764;
