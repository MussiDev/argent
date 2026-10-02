CREATE TABLE "exchange_rate_refresh_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"failed_at" timestamp with time zone NOT NULL,
	"code" text NOT NULL,
	"status_code" smallint,
	"detail" text,
	CONSTRAINT "exchange_rate_refresh_failures_code_check" CHECK ("exchange_rate_refresh_failures"."code" in ('provider_unreachable', 'provider_timeout', 'provider_bad_status', 'provider_invalid_payload')),
	CONSTRAINT "exchange_rate_refresh_failures_status_code_check" CHECK ("exchange_rate_refresh_failures"."status_code" between 100 and 599),
	CONSTRAINT "exchange_rate_refresh_failures_detail_length_check" CHECK (char_length("exchange_rate_refresh_failures"."detail") <= 200)
);
--> statement-breakpoint
CREATE TABLE "exchange_rate_sync" (
	"id" smallint PRIMARY KEY NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_success_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "exchange_rate_sync_single_row_check" CHECK ("exchange_rate_sync"."id" = 1),
	CONSTRAINT "exchange_rate_sync_failures_check" CHECK ("exchange_rate_sync"."consecutive_failures" >= 0)
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"rate_type" text PRIMARY KEY NOT NULL,
	"buy" bigint NOT NULL,
	"sell" bigint NOT NULL,
	"provider_updated_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "exchange_rates_rate_type_check" CHECK ("exchange_rates"."rate_type" in ('oficial', 'blue', 'mep', 'ccl', 'mayorista', 'cripto', 'tarjeta')),
	CONSTRAINT "exchange_rates_buy_range_check" CHECK ("exchange_rates"."buy" between 1 and 100000000000),
	CONSTRAINT "exchange_rates_sell_range_check" CHECK ("exchange_rates"."sell" between 1 and 100000000000)
);
--> statement-breakpoint
CREATE INDEX "exchange_rate_refresh_failures_failed_at_idx" ON "exchange_rate_refresh_failures" USING btree ("failed_at");