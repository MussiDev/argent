-- FEAT-003: accounts.include_in_available says whether an account counts toward the available total.
-- Hand-edited (drizzle-kit emits only the column and the constraint). The migrator runs this file
-- in one transaction, so a failing statement leaves no column and no changed row.
-- 1. The column enters with a temporary default so existing rows are valid.
ALTER TABLE "accounts" ADD COLUMN "include_in_available" boolean NOT NULL DEFAULT false;--> statement-breakpoint
-- 2. Backfill by type: cash, bank account and digital wallet are available money; savings and
-- credit card are not (the same list as defaultIncludeInAvailable in packages/shared).
UPDATE "accounts" SET "include_in_available" = true WHERE "type" IN ('cash', 'bank_account', 'digital_wallet');--> statement-breakpoint
-- 3. No default afterwards: an insert that forgets the value must fail instead of choosing one.
ALTER TABLE "accounts" ALTER COLUMN "include_in_available" DROP DEFAULT;--> statement-breakpoint
-- 4. A credit card is debt, never available money. Added after the backfill, which leaves cards false.
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_credit_card_not_available_check" CHECK ("accounts"."type" <> 'credit_card' or "accounts"."include_in_available" = false);
