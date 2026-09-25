CREATE TABLE "core_tenancy"."store_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	CONSTRAINT "store_codes_tenantId_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "core_tenancy"."tenants" ADD COLUMN "store_code" text NOT NULL;--> statement-breakpoint
ALTER TABLE "core_tenancy"."store_codes" ADD CONSTRAINT "store_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_tenancy"."tenants" ADD CONSTRAINT "tenants_storeCode_unique" UNIQUE("store_code");--> statement-breakpoint
ALTER TABLE "core_tenancy"."tenants" ADD CONSTRAINT "tenants_store_code_format" CHECK ("core_tenancy"."tenants"."store_code" ~ '^[A-HJ-NP-Z2-9]{6}$');