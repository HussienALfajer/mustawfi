-- Custom SQL migration file, put your code below! --
GRANT USAGE ON SCHEMA "rls_fixture" TO mustawfi_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "rls_fixture"."items" TO mustawfi_app;
--> statement-breakpoint
ALTER TABLE "rls_fixture"."items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rls_fixture"."items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "rls_fixture"."items"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
