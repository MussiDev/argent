CREATE TABLE "auth_attempts" (
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "auth_attempts_kind_key_window_start_pk" PRIMARY KEY("kind","key","window_start"),
	CONSTRAINT "auth_attempts_kind_check" CHECK ("auth_attempts"."kind" in ('sign_in_account', 'sign_in_ip', 'register_ip', 'reset_ip', 'reset_email', 'resend_account'))
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"to_email" text,
	"language" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "email_outbox_kind_check" CHECK ("email_outbox"."kind" in ('verification', 'password_reset', 'discard'))
);
--> statement-breakpoint
CREATE TABLE "one_time_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_time_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "one_time_tokens_purpose_check" CHECK ("one_time_tokens"."purpose" in ('email_verification', 'password_reset'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by" uuid,
	CONSTRAINT "sessions_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"default_rate_type" text DEFAULT 'mep' NOT NULL,
	"display_currency" text DEFAULT 'ARS' NOT NULL,
	"time_zone" text NOT NULL,
	"language" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_default_rate_type_check" CHECK ("users"."default_rate_type" in ('oficial', 'blue', 'mep', 'ccl', 'mayorista', 'cripto', 'tarjeta')),
	CONSTRAINT "users_display_currency_check" CHECK ("users"."display_currency" in ('ARS', 'USD')),
	CONSTRAINT "users_language_check" CHECK ("users"."language" in ('es', 'en'))
);
--> statement-breakpoint
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_pending_idx" ON "email_outbox" USING btree ("sent_at") WHERE "email_outbox"."sent_at" is null;--> statement-breakpoint
CREATE INDEX "one_time_tokens_user_id_purpose_idx" ON "one_time_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_family_id_idx" ON "sessions" USING btree ("family_id");