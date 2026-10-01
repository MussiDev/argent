CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"currency" text NOT NULL,
	"opening_balance" bigint NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_name_length_check" CHECK (char_length("accounts"."name") between 1 and 50),
	CONSTRAINT "accounts_type_check" CHECK ("accounts"."type" in ('cash', 'bank_account', 'digital_wallet', 'credit_card', 'savings')),
	CONSTRAINT "accounts_currency_check" CHECK ("accounts"."currency" in ('ARS', 'USD'))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_owner_name_unique" ON "accounts" USING btree ("owner_id",lower("name"));--> statement-breakpoint
CREATE INDEX "accounts_owner_created_idx" ON "accounts" USING btree ("owner_id","created_at","id");--> statement-breakpoint
-- Hand-written (drizzle-kit does not model triggers): type, currency and owner are immutable
-- after insert (defence in depth behind the request validation, FR-04).
CREATE FUNCTION "accounts_immutable_fields"() RETURNS trigger AS $$
BEGIN
	IF NEW."type" IS DISTINCT FROM OLD."type"
		OR NEW."currency" IS DISTINCT FROM OLD."currency"
		OR NEW."owner_id" IS DISTINCT FROM OLD."owner_id" THEN
		RAISE EXCEPTION 'accounts.type, accounts.currency and accounts.owner_id are immutable'
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "accounts_immutable_fields_trigger" BEFORE UPDATE ON "accounts" FOR EACH ROW EXECUTE FUNCTION "accounts_immutable_fields"();