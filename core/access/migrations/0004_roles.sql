CREATE TABLE "core_access"."role_limits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"limit_id" text NOT NULL,
	"value" numeric(20, 4) NOT NULL,
	CONSTRAINT "role_limits_once" UNIQUE("tenant_id","role_id","limit_id"),
	CONSTRAINT "role_limits_value" CHECK ("core_access"."role_limits"."value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "core_access"."role_permissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_once" UNIQUE("tenant_id","role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "core_access"."roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"template" text,
	"is_owner" boolean NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	CONSTRAINT "roles_id_per_tenant" UNIQUE("tenant_id","id"),
	CONSTRAINT "roles_template" CHECK ("core_access"."roles"."template" in ('owner', 'accountant', 'sectionCashier', 'repairTechnician', 'topUpOperator')),
	CONSTRAINT "roles_owner_template" CHECK ("core_access"."roles"."is_owner" = ("core_access"."roles"."template" is not distinct from 'owner')),
	CONSTRAINT "roles_owner_not_archived" CHECK (not ("core_access"."roles"."is_owner" and "core_access"."roles"."archived_at" is not null)),
	CONSTRAINT "roles_archived_by" CHECK (("core_access"."roles"."archived_at" is null) = ("core_access"."roles"."archived_by" is null))
);
--> statement-breakpoint
CREATE TABLE "core_access"."user_departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	CONSTRAINT "user_departments_once" UNIQUE("tenant_id","user_id","department_id")
);
--> statement-breakpoint
ALTER TABLE "core_access"."users" ADD COLUMN "role_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "core_access"."users" ADD COLUMN "department_scope" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_one_owner_per_tenant" ON "core_access"."roles" USING btree ("tenant_id") WHERE "core_access"."roles"."is_owner";--> statement-breakpoint
CREATE UNIQUE INDEX "roles_active_name_per_tenant" ON "core_access"."roles" USING btree ("tenant_id","name") WHERE "core_access"."roles"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "core_access"."users" ADD CONSTRAINT "users_id_per_tenant" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "core_access"."users" ADD CONSTRAINT "users_department_scope" CHECK ("core_access"."users"."department_scope" in ('all', 'listed'));