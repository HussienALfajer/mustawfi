CREATE SCHEMA "core_audit";
--> statement-breakpoint
CREATE TABLE "core_audit"."entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"device_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE INDEX "entries_by_time" ON "core_audit"."entries" USING btree ("tenant_id","created_at");