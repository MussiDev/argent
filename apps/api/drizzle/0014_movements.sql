-- NOTE: the `accounts_id_owner_unique` statement below was moved BY HAND before the composite
-- foreign keys of `movements`, because drizzle-kit emits it last and PostgreSQL needs the unique
-- constraint to exist first. Regenerating this file (for example after a rebase) loses that
-- reorder: redo it, and run migration.test.ts, which applies this file.
CREATE TABLE "movement_rate_limits" (
	"owner_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "movement_rate_limits_owner_id_window_start_pk" PRIMARY KEY("owner_id","window_start"),
	CONSTRAINT "movement_rate_limits_count_check" CHECK ("movement_rate_limits"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"type" text NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"note" text,
	"rate" bigint NOT NULL,
	"rate_source" text NOT NULL,
	"rate_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movements_type_check" CHECK ("movements"."type" in ('expense', 'income')),
	CONSTRAINT "movements_amount_range_check" CHECK ("movements"."amount" between 1 and 1000000000000000),
	CONSTRAINT "movements_occurred_at_check" CHECK ("movements"."occurred_at" >= '1970-01-01T00:00:00Z'::timestamptz),
	CONSTRAINT "movements_note_length_check" CHECK (char_length("movements"."note") <= 500),
	CONSTRAINT "movements_rate_range_check" CHECK ("movements"."rate" between 1 and 100000000000),
	CONSTRAINT "movements_rate_source_check" CHECK ("movements"."rate_source" in ('automatic', 'manual')),
	CONSTRAINT "movements_rate_type_check" CHECK ("movements"."rate_type" in ('oficial', 'blue', 'mep', 'ccl', 'mayorista', 'cripto', 'tarjeta')),
	CONSTRAINT "movements_rate_source_type_check" CHECK (("movements"."rate_source" = 'automatic') = ("movements"."rate_type" is not null))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_id_owner_unique" UNIQUE("id","owner_id");--> statement-breakpoint
ALTER TABLE "movement_rate_limits" ADD CONSTRAINT "movement_rate_limits_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_account_owner_fk" FOREIGN KEY ("account_id","owner_id") REFERENCES "public"."accounts"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_category_owner_kind_fk" FOREIGN KEY ("category_id","owner_id","type") REFERENCES "public"."categories"("id","owner_id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movements_owner_date_idx" ON "movements" USING btree ("owner_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "movements_account_idx" ON "movements" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "movements_category_idx" ON "movements" USING btree ("category_id");
