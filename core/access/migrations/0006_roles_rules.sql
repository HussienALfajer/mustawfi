-- Custom SQL migration file, put your code below! --
-- Roles and scopes (core-foundation slice 5). The foreign keys inside the tenant are
-- tenant-scoped: a plain one would bypass row-level security in its check.
ALTER TABLE "core_access"."roles" ADD CONSTRAINT "roles_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
ALTER TABLE "core_access"."role_permissions" ADD CONSTRAINT "role_permissions_role_fk"
  FOREIGN KEY ("tenant_id", "role_id") REFERENCES "core_access"."roles"("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "core_access"."role_limits" ADD CONSTRAINT "role_limits_role_fk"
  FOREIGN KEY ("tenant_id", "role_id") REFERENCES "core_access"."roles"("tenant_id", "id");
--> statement-breakpoint
-- No backfill: a database with users from before this slice fails here and is recreated (there
-- is no production tenant yet).
ALTER TABLE "core_access"."users" ADD CONSTRAINT "users_role_fk"
  FOREIGN KEY ("tenant_id", "role_id") REFERENCES "core_access"."roles"("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "core_access"."user_departments" ADD CONSTRAINT "user_departments_user_fk"
  FOREIGN KEY ("tenant_id", "user_id") REFERENCES "core_access"."users"("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "core_access"."user_departments" ADD CONSTRAINT "user_departments_department_fk"
  FOREIGN KEY ("tenant_id", "department_id")
  REFERENCES "core_tenancy"."departments"("tenant_id", "id");
--> statement-breakpoint
-- Roles are archived, never deleted. `is_owner` and `template` are fixed at creation: only the
-- name and the archive columns may change, so the owner role stays the owner role (rule 14).
GRANT SELECT, INSERT ON "core_access"."roles" TO mustawfi_app;
--> statement-breakpoint
GRANT UPDATE ("name", "archived_at", "archived_by") ON "core_access"."roles" TO mustawfi_app;
--> statement-breakpoint
-- Removing a permission or a listed department comes with role and user editing (slice 6),
-- which adds DELETE on these two with its audit entries.
GRANT SELECT, INSERT ON "core_access"."role_permissions", "core_access"."user_departments" TO mustawfi_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "core_access"."role_limits" TO mustawfi_app;
--> statement-breakpoint
GRANT UPDATE ("value") ON "core_access"."role_limits" TO mustawfi_app;
--> statement-breakpoint
ALTER TABLE "core_access"."roles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_access"."roles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_access"."roles"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "core_access"."role_permissions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_access"."role_permissions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_access"."role_permissions"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "core_access"."role_limits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_access"."role_limits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_access"."role_limits"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "core_access"."user_departments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_access"."user_departments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_access"."user_departments"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
