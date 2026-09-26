CREATE TABLE "core_access"."login_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"method" text NOT NULL,
	"login_hash" text,
	"user_id" uuid,
	"device_id" uuid,
	CONSTRAINT "login_attempts_method" CHECK ("core_access"."login_attempts"."method" in ('password', 'pin')),
	CONSTRAINT "login_attempts_key" CHECK (("core_access"."login_attempts"."method" = 'password' and "core_access"."login_attempts"."login_hash" is not null and "core_access"."login_attempts"."user_id" is null and "core_access"."login_attempts"."device_id" is null)
        or ("core_access"."login_attempts"."method" = 'pin' and "core_access"."login_attempts"."login_hash" is null and "core_access"."login_attempts"."user_id" is not null and "core_access"."login_attempts"."device_id" is not null)),
	CONSTRAINT "login_attempts_login_hash_format" CHECK ("core_access"."login_attempts"."login_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "core_access"."reset_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"issued_by_support" boolean NOT NULL,
	"issued_by" text NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "reset_codes_hash_per_tenant" UNIQUE("tenant_id","code_hash"),
	CONSTRAINT "reset_codes_hash_format" CHECK ("core_access"."reset_codes"."code_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "core_access"."sessions" ADD COLUMN "method" text DEFAULT 'password' NOT NULL;--> statement-breakpoint
CREATE INDEX "login_attempts_by_login" ON "core_access"."login_attempts" USING btree ("tenant_id","login_hash","created_at");--> statement-breakpoint
CREATE INDEX "login_attempts_by_pin" ON "core_access"."login_attempts" USING btree ("tenant_id","user_id","device_id","created_at");--> statement-breakpoint
ALTER TABLE "core_access"."sessions" ADD CONSTRAINT "sessions_method" CHECK ("core_access"."sessions"."method" in ('password', 'pin'));--> statement-breakpoint
ALTER TABLE "core_access"."sessions" ADD CONSTRAINT "sessions_pin_on_device" CHECK ("core_access"."sessions"."method" <> 'pin' or "core_access"."sessions"."device_id" is not null);