CREATE SCHEMA "core_sync";
--> statement-breakpoint
CREATE TABLE "core_sync"."changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"row" jsonb,
	CONSTRAINT "changes_seq_per_tenant" UNIQUE("tenant_id","seq"),
	CONSTRAINT "changes_seq_positive" CHECK ("core_sync"."changes"."seq" > 0)
);
--> statement-breakpoint
CREATE TABLE "core_sync"."received_ops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"device_seq" bigint NOT NULL,
	"type" text NOT NULL,
	"payload_version" integer NOT NULL,
	"shift_id" uuid NOT NULL,
	"device_created_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"problem_code" text,
	"problem_detail" text,
	CONSTRAINT "received_ops_device_seq" UNIQUE("tenant_id","device_id","device_seq"),
	CONSTRAINT "received_ops_device_seq_positive" CHECK ("core_sync"."received_ops"."device_seq" > 0),
	CONSTRAINT "received_ops_outcome" CHECK (("core_sync"."received_ops"."status" = 'accepted' and "core_sync"."received_ops"."result" is not null and "core_sync"."received_ops"."problem_code" is null)
        or ("core_sync"."received_ops"."status" = 'rejected' and "core_sync"."received_ops"."result" is null and "core_sync"."received_ops"."problem_code" is not null))
);
--> statement-breakpoint
CREATE TABLE "core_sync"."tenant_counters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"change_seq" bigint NOT NULL,
	CONSTRAINT "tenant_counters_tenantId_unique" UNIQUE("tenant_id"),
	CONSTRAINT "tenant_counters_change_seq_positive" CHECK ("core_sync"."tenant_counters"."change_seq" > 0)
);
