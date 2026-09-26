-- Custom SQL migration file, put your code below! --
-- Sign-in hardening (core-foundation slice 8).
ALTER TABLE "core_access"."login_attempts" ADD CONSTRAINT "login_attempts_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
ALTER TABLE "core_access"."login_attempts" ADD CONSTRAINT "login_attempts_user_fk"
  FOREIGN KEY ("tenant_id", "user_id") REFERENCES "core_access"."users"("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "core_access"."reset_codes" ADD CONSTRAINT "reset_codes_user_fk"
  FOREIGN KEY ("tenant_id", "user_id") REFERENCES "core_access"."users"("tenant_id", "id");
--> statement-breakpoint
-- Failed sign-ins are counters, not records: they are pruned by age and cleared by a success.
-- The audit log keeps every attempt.
GRANT SELECT, INSERT, DELETE ON "core_access"."login_attempts" TO mustawfi_app;
--> statement-breakpoint
-- A reset code is never deleted; using it is the one change it records.
GRANT SELECT, INSERT ON "core_access"."reset_codes" TO mustawfi_app;
--> statement-breakpoint
GRANT UPDATE ("used_at") ON "core_access"."reset_codes" TO mustawfi_app;
--> statement-breakpoint
ALTER TABLE "core_access"."login_attempts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_access"."login_attempts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_access"."login_attempts"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "core_access"."reset_codes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_access"."reset_codes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_access"."reset_codes"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
