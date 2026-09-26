CREATE TABLE "core_access"."recovery_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "recovery_codes_hash_per_tenant" UNIQUE("tenant_id","code_hash"),
	CONSTRAINT "recovery_codes_hash_format" CHECK ("core_access"."recovery_codes"."code_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "core_access"."users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "core_access"."users" ADD COLUMN "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "core_access"."users" ADD COLUMN "totp_last_step" bigint;--> statement-breakpoint
CREATE INDEX "recovery_codes_by_user" ON "core_access"."recovery_codes" USING btree ("tenant_id","user_id");--> statement-breakpoint
ALTER TABLE "core_access"."users" ADD CONSTRAINT "users_totp_enabled_has_secret" CHECK ("core_access"."users"."totp_enabled_at" is null or "core_access"."users"."totp_secret" is not null);--> statement-breakpoint
ALTER TABLE "core_access"."users" ADD CONSTRAINT "users_totp_needs_password" CHECK ("core_access"."users"."totp_secret" is null or "core_access"."users"."password_hash" is not null);--> statement-breakpoint
ALTER TABLE "core_access"."users" ADD CONSTRAINT "users_totp_secret_sealed" CHECK ("core_access"."users"."totp_secret" ~ '^v1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$');