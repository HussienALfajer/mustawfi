-- Custom SQL migration file, put your code below! --
-- A tenant points at its default branch, and the branch at its tenant: the FK is deferred so
-- both rows commit together.
ALTER TABLE "core_tenancy"."tenants" ADD CONSTRAINT "tenants_default_branch_fk"
  FOREIGN KEY ("branch_id") REFERENCES "core_tenancy"."branches"("id")
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "core_tenancy" TO mustawfi_app;
--> statement-breakpoint
-- Master data: archived, never deleted (ADR-0016), so no DELETE.
GRANT SELECT, INSERT, UPDATE ON "core_tenancy"."tenants", "core_tenancy"."branches" TO mustawfi_app;
--> statement-breakpoint
ALTER TABLE "core_tenancy"."tenants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_tenancy"."tenants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_tenancy"."tenants"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "core_tenancy"."branches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_tenancy"."branches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_tenancy"."branches"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
