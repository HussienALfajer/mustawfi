CREATE SCHEMA "core_access";
--> statement-breakpoint
CREATE TABLE "core_access"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"login" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_owner" boolean NOT NULL,
	CONSTRAINT "users_login_per_tenant" UNIQUE("tenant_id","login")
);
