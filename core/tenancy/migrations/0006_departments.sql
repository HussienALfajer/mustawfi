CREATE TABLE "core_tenancy"."departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean NOT NULL,
	"sort_order" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	CONSTRAINT "departments_id_per_tenant" UNIQUE("tenant_id","id"),
	CONSTRAINT "departments_default_not_archived" CHECK (not ("core_tenancy"."departments"."is_default" and "core_tenancy"."departments"."archived_at" is not null)),
	CONSTRAINT "departments_archived_by" CHECK (("core_tenancy"."departments"."archived_at" is null) = ("core_tenancy"."departments"."archived_by" is null))
);
--> statement-breakpoint
ALTER TABLE "core_tenancy"."departments" ADD CONSTRAINT "departments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_one_default_per_tenant" ON "core_tenancy"."departments" USING btree ("tenant_id") WHERE "core_tenancy"."departments"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "departments_active_name_per_tenant" ON "core_tenancy"."departments" USING btree ("tenant_id","name") WHERE "core_tenancy"."departments"."archived_at" is null;