CREATE SCHEMA "rls_fixture";
--> statement-breakpoint
CREATE TABLE "rls_fixture"."items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL
);
