CREATE TABLE "core_tenancy"."licenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"jws" text NOT NULL,
	"kid" text NOT NULL,
	"plan" text NOT NULL,
	"issued_at" timestamp (3) with time zone NOT NULL,
	"not_before" timestamp (3) with time zone NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"grace_days" integer NOT NULL,
	"read_only_days" integer NOT NULL,
	"max_offline_days" integer NOT NULL,
	"limits" jsonb NOT NULL,
	"entitlements" jsonb NOT NULL,
	"installed_at" timestamp with time zone NOT NULL,
	"installed_by" uuid,
	CONSTRAINT "licenses_expiry_after_validity" CHECK ("core_tenancy"."licenses"."expires_at" > "core_tenancy"."licenses"."not_before"),
	CONSTRAINT "licenses_days" CHECK ("core_tenancy"."licenses"."grace_days" >= 0 and "core_tenancy"."licenses"."read_only_days" >= 0 and "core_tenancy"."licenses"."max_offline_days" >= 1)
);
--> statement-breakpoint
ALTER TABLE "core_tenancy"."licenses" ADD CONSTRAINT "licenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "licenses_one_per_issue" ON "core_tenancy"."licenses" USING btree ("tenant_id","issued_at");