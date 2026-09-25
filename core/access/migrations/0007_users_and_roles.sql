CREATE TABLE "core_access"."role_template_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"grant_id" text NOT NULL,
	CONSTRAINT "role_template_grants_once" UNIQUE("tenant_id","role_id","kind","grant_id"),
	CONSTRAINT "role_template_grants_kind" CHECK ("core_access"."role_template_grants"."kind" in ('permission', 'limit'))
);
--> statement-breakpoint
ALTER TABLE "core_access"."users" ALTER COLUMN "login" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "core_access"."users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "core_access"."users" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "core_access"."users" ADD COLUMN "pin_verifier" text;--> statement-breakpoint
ALTER TABLE "core_access"."users" ADD COLUMN "pin_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "core_access"."users" ADD CONSTRAINT "users_status" CHECK ("core_access"."users"."status" in ('active', 'deactivated'));--> statement-breakpoint
ALTER TABLE "core_access"."users" ADD CONSTRAINT "users_password_needs_login" CHECK ("core_access"."users"."password_hash" is null or "core_access"."users"."login" is not null);--> statement-breakpoint
ALTER TABLE "core_access"."users" ADD CONSTRAINT "users_pin_changed_at" CHECK (("core_access"."users"."pin_verifier" is null) = ("core_access"."users"."pin_changed_at" is null));--> statement-breakpoint
ALTER TABLE "core_access"."users" ADD CONSTRAINT "users_password_argon2id" CHECK ("core_access"."users"."password_hash" like '$argon2id$%');--> statement-breakpoint
ALTER TABLE "core_access"."users" ADD CONSTRAINT "users_pin_argon2id" CHECK ("core_access"."users"."pin_verifier" like '$argon2id$%');