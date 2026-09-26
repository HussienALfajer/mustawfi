-- Custom SQL migration file, put your code below! --
-- Two-factor authentication (core-foundation slice 10).
ALTER TABLE "core_access"."recovery_codes" ADD CONSTRAINT "recovery_codes_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
ALTER TABLE "core_access"."recovery_codes" ADD CONSTRAINT "recovery_codes_user_fk"
  FOREIGN KEY ("tenant_id", "user_id") REFERENCES "core_access"."users"("tenant_id", "id");
--> statement-breakpoint
-- Recovery codes are credentials, not records: using one sets `used_at`; disabling, clearing,
-- or enabling two-factor authentication again deletes the user's codes. The audit log keeps
-- what happened.
GRANT SELECT, INSERT, DELETE ON "core_access"."recovery_codes" TO mustawfi_app;
--> statement-breakpoint
GRANT UPDATE ("used_at") ON "core_access"."recovery_codes" TO mustawfi_app;
--> statement-breakpoint
ALTER TABLE "core_access"."recovery_codes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_access"."recovery_codes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_access"."recovery_codes"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
