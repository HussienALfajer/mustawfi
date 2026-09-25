-- Custom SQL migration file, put your code below! --
-- core.organization depends on core.tenancy: a profile belongs to an existing tenant (integrity only).
ALTER TABLE "core_organization"."store_profiles" ADD CONSTRAINT "store_profiles_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
GRANT USAGE ON SCHEMA "core_organization" TO mustawfi_app;
--> statement-breakpoint
-- Edited, never deleted: no DELETE.
GRANT SELECT, INSERT, UPDATE ON "core_organization"."store_profiles" TO mustawfi_app;
--> statement-breakpoint
ALTER TABLE "core_organization"."store_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_organization"."store_profiles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_organization"."store_profiles"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
