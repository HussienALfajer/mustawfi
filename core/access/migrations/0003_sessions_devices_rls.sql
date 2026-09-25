-- Custom SQL migration file, put your code below! --
ALTER TABLE "core_access"."registration_codes" ADD CONSTRAINT "registration_codes_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
ALTER TABLE "core_access"."devices" ADD CONSTRAINT "devices_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
ALTER TABLE "core_access"."sessions" ADD CONSTRAINT "sessions_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
-- Nothing here is ever deleted: a used code stays used, and a device's prefix stays taken, so
-- it is never reused (ADR-0020). Updates are limited to the columns that record an event.
GRANT SELECT, INSERT ON "core_access"."registration_codes", "core_access"."devices", "core_access"."sessions" TO mustawfi_app;
--> statement-breakpoint
GRANT UPDATE ("used_at") ON "core_access"."registration_codes" TO mustawfi_app;
--> statement-breakpoint
GRANT UPDATE ("revoked_at", "revoked_by") ON "core_access"."sessions" TO mustawfi_app;
--> statement-breakpoint
ALTER TABLE "core_access"."registration_codes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_access"."registration_codes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_access"."registration_codes"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "core_access"."devices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_access"."devices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_access"."devices"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "core_access"."sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_access"."sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_access"."sessions"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
