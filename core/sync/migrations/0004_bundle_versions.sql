CREATE TABLE "core_sync"."bundle_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"device_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"digest" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bundle_versions_device" UNIQUE("tenant_id","device_id"),
	CONSTRAINT "bundle_versions_version_positive" CHECK ("core_sync"."bundle_versions"."version" > 0)
);
