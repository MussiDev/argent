CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sign_in_challenges" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"credentials_version" integer NOT NULL,
	"via" text NOT NULL,
	"language" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sign_in_challenges_via_check" CHECK ("sign_in_challenges"."via" in ('password', 'google')),
	CONSTRAINT "sign_in_challenges_language_check" CHECK ("sign_in_challenges"."language" in ('es', 'en'))
);
--> statement-breakpoint
CREATE TABLE "user_two_factor" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"secret_sealed" text NOT NULL,
	"enabled_at" timestamp with time zone,
	"last_used_step" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_attempts" DROP CONSTRAINT "auth_attempts_kind_check";--> statement-breakpoint
ALTER TABLE "email_outbox" DROP CONSTRAINT "email_outbox_kind_check";--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_in_challenges" ADD CONSTRAINT "sign_in_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_two_factor" ADD CONSTRAINT "user_two_factor_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recovery_codes_user_id_idx" ON "recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sign_in_challenges_expires_at_idx" ON "sign_in_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sign_in_challenges_user_id_idx" ON "sign_in_challenges" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "auth_attempts" ADD CONSTRAINT "auth_attempts_kind_check" CHECK ("auth_attempts"."kind" in ('sign_in_account', 'sign_in_ip', 'register_ip', 'reset_ip', 'reset_email', 'resend_account', 'google_start_ip', 'second_factor_user_15m', 'second_factor_user_24h', 'two_factor_disable_user', 'two_factor_disable_user_24h'));--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_kind_check" CHECK ("email_outbox"."kind" in ('verification', 'password_reset', 'discard', 'two_factor_enabled', 'two_factor_disabled'));