-- Custom SQL migration file, put your code below! --
-- User and role management (core-foundation slice 6).
ALTER TABLE "core_access"."role_template_grants" ADD CONSTRAINT "role_template_grants_role_fk"
  FOREIGN KEY ("tenant_id", "role_id") REFERENCES "core_access"."roles"("tenant_id", "id");
--> statement-breakpoint
-- A role's template grants, once recorded, stay recorded: that is what keeps a removed
-- permission removed.
GRANT SELECT, INSERT ON "core_access"."role_template_grants" TO mustawfi_app;
--> statement-breakpoint
-- Editing a role replaces its permissions and limits, and editing a user their listed
-- departments. These are configuration rows, not documents; every change is audited with the
-- whole set before and after.
GRANT DELETE ON "core_access"."role_permissions", "core_access"."role_limits", "core_access"."user_departments" TO mustawfi_app;
--> statement-breakpoint
ALTER TABLE "core_access"."role_template_grants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_access"."role_template_grants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_access"."role_template_grants"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
