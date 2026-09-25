-- Custom SQL migration file, put your code below! --
-- inventory depends on core.tenancy: a product belongs to an existing tenant (integrity only).
ALTER TABLE "inventory"."products" ADD CONSTRAINT "products_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
GRANT USAGE ON SCHEMA "inventory" TO mustawfi_app;
--> statement-breakpoint
-- Master data is never deleted; editing and archiving grant UPDATE when they come.
GRANT SELECT, INSERT ON "inventory"."products" TO mustawfi_app;
--> statement-breakpoint
ALTER TABLE "inventory"."products" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory"."products" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "inventory"."products"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
