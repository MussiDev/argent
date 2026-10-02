CREATE TABLE "deletion_grants" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_family_id" uuid NOT NULL,
	"credentials_version" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "purpose" text DEFAULT 'sign_in' NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "session_family_id" uuid;--> statement-breakpoint
ALTER TABLE "deletion_grants" ADD CONSTRAINT "deletion_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deletion_grants_user_id_idx" ON "deletion_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "deletion_grants_expires_at_idx" ON "deletion_grants" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_payload_user_id_idx" ON "email_outbox" USING btree (("payload"->>'userId'));--> statement-breakpoint
CREATE INDEX "email_outbox_to_email_idx" ON "email_outbox" USING btree ("to_email") WHERE "email_outbox"."to_email" is not null;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_purpose_check" CHECK ("oauth_states"."purpose" in ('sign_in', 'delete_account'));--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_delete_account_binding_check" CHECK ("oauth_states"."purpose" <> 'delete_account' or ("oauth_states"."user_id" is not null and "oauth_states"."session_family_id" is not null));--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_sign_in_unbound_check" CHECK ("oauth_states"."purpose" <> 'sign_in' or ("oauth_states"."user_id" is null and "oauth_states"."session_family_id" is null));