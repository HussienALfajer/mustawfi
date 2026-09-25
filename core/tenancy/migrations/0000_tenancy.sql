CREATE SCHEMA "core_tenancy";
--> statement-breakpoint
CREATE TABLE "core_tenancy"."branches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean NOT NULL,
	CONSTRAINT "branches_branch_id_is_id" CHECK ("core_tenancy"."branches"."branch_id" = "core_tenancy"."branches"."id")
);
--> statement-breakpoint
CREATE TABLE "core_tenancy"."tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"base_currency" text NOT NULL,
	CONSTRAINT "tenants_tenantId_unique" UNIQUE("tenant_id"),
	CONSTRAINT "tenants_tenant_id_is_id" CHECK ("core_tenancy"."tenants"."tenant_id" = "core_tenancy"."tenants"."id"),
	CONSTRAINT "tenants_base_currency_code" CHECK ("core_tenancy"."tenants"."base_currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "core_tenancy"."branches" ADD CONSTRAINT "branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branches_one_default_per_tenant" ON "core_tenancy"."branches" USING btree ("tenant_id") WHERE "core_tenancy"."branches"."is_default";