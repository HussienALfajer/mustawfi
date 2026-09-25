CREATE TABLE "core_sync"."operation_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"op_id" uuid NOT NULL,
	"code" text NOT NULL,
	"detail" jsonb NOT NULL,
	CONSTRAINT "operation_flags_code_per_op" UNIQUE("tenant_id","op_id","code"),
	CONSTRAINT "operation_flags_code" CHECK ("core_sync"."operation_flags"."code" in ('deviceRevoked', 'licenseReadOnly', 'permissionMissing', 'overrideNotAuthorized', 'numberGap'))
);
--> statement-breakpoint
ALTER TABLE "core_sync"."received_ops" ADD CONSTRAINT "received_ops_id_per_tenant" UNIQUE("tenant_id","id");