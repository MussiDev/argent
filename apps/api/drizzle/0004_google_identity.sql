CREATE TABLE "oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"binding_hash" text NOT NULL,
	"nonce_hash" text NOT NULL,
	"code_verifier" text NOT NULL,
	"time_zone" text NOT NULL,
	"language" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "oauth_states_language_check" CHECK ("oauth_states"."language" in ('es', 'en'))
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"email_authoritative" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_identities_provider_subject_unique" UNIQUE("provider","subject"),
	CONSTRAINT "user_identities_user_id_provider_unique" UNIQUE("user_id","provider"),
	CONSTRAINT "user_identities_provider_check" CHECK ("user_identities"."provider" in ('google'))
);
--> statement-breakpoint
ALTER TABLE "auth_attempts" DROP CONSTRAINT "auth_attempts_kind_check";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_states_expires_at_idx" ON "oauth_states" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "auth_attempts" ADD CONSTRAINT "auth_attempts_kind_check" CHECK ("auth_attempts"."kind" in ('sign_in_account', 'sign_in_ip', 'register_ip', 'reset_ip', 'reset_email', 'resend_account', 'google_start_ip'));