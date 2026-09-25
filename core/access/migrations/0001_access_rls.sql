-- Custom SQL migration file, put your code below! --
-- core.access depends on core.tenancy: a user belongs to an existing tenant (integrity only).
ALTER TABLE "core_access"."users" ADD CONSTRAINT "users_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
GRANT USAGE ON SCHEMA "core_access" TO mustawfi_app;
--> statement-breakpoint
-- Master data: archived, never deleted (ADR-0016), so no DELETE.
GRANT SELECT, INSERT, UPDATE ON "core_access"."users" TO mustawfi_app;
--> statement-breakpoint
ALTER TABLE "core_access"."users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_access"."users" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_access"."users"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
