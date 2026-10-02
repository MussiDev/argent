CREATE TABLE "holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"instrument_name" text NOT NULL,
	"instrument_type" text NOT NULL,
	"quantity" bigint NOT NULL,
	"valuation_currency" text NOT NULL,
	"total_cost" bigint,
	"unit_price" bigint,
	"price_source" text,
	"priced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holdings_ticker_length_check" CHECK (char_length("holdings"."ticker") between 1 and 20),
	CONSTRAINT "holdings_instrument_name_length_check" CHECK (char_length("holdings"."instrument_name") between 1 and 100),
	CONSTRAINT "holdings_instrument_type_check" CHECK ("holdings"."instrument_type" in ('stock', 'cedear', 'bond', 'mutual_fund', 'fixed_term_deposit', 'crypto', 'other')),
	CONSTRAINT "holdings_valuation_currency_check" CHECK ("holdings"."valuation_currency" in ('ARS', 'USD')),
	CONSTRAINT "holdings_quantity_check" CHECK ("holdings"."quantity" > 0 and "holdings"."quantity" <= 1000000000000000000),
	CONSTRAINT "holdings_total_cost_check" CHECK ("holdings"."total_cost" is null or ("holdings"."total_cost" > 0 and "holdings"."total_cost" <= 1000000000000000)),
	CONSTRAINT "holdings_unit_price_check" CHECK ("holdings"."unit_price" is null or ("holdings"."unit_price" > 0 and "holdings"."unit_price" <= 1000000000000)),
	CONSTRAINT "holdings_price_source_check" CHECK ("holdings"."price_source" is null or ("holdings"."price_source" in ('import', 'manual', 'automatic'))),
	CONSTRAINT "holdings_price_all_or_none_check" CHECK (("holdings"."unit_price" is null and "holdings"."price_source" is null and "holdings"."priced_at" is null) or ("holdings"."unit_price" is not null and "holdings"."price_source" is not null and "holdings"."priced_at" is not null)),
	CONSTRAINT "holdings_crypto_usd_check" CHECK ("holdings"."instrument_type" <> 'crypto' or "holdings"."valuation_currency" = 'USD')
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolios_id_owner_id_key" UNIQUE("id","owner_id"),
	CONSTRAINT "portfolios_name_length_check" CHECK (char_length("portfolios"."name") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_portfolio_owner_fk" FOREIGN KEY ("portfolio_id","owner_id") REFERENCES "public"."portfolios"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holdings_portfolio_ticker_key" ON "holdings" USING btree ("portfolio_id",lower("ticker"));--> statement-breakpoint
CREATE INDEX "holdings_owner_id_idx" ON "holdings" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "portfolios_owner_id_idx" ON "portfolios" USING btree ("owner_id");