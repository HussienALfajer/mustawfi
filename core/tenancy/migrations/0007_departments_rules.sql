-- Custom SQL migration file, put your code below! --
-- Departments are master data: archived, never deleted (ADR-0016), so no DELETE.
GRANT SELECT, INSERT, UPDATE ON "core_tenancy"."departments" TO mustawfi_app;
--> statement-breakpoint
-- The default department is chosen when the tenant is created and stays the default: a tenant
-- has exactly one (core-foundation rule 28), so `is_default` never changes.
CREATE FUNCTION "core_tenancy"."refuse_default_department_change"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW."is_default" IS DISTINCT FROM OLD."is_default" THEN
    RAISE EXCEPTION 'the default department never changes' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "core_tenancy"."refuse_default_department_change"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "departments_keep_default" BEFORE UPDATE OF "is_default" ON "core_tenancy"."departments"
  FOR EACH ROW EXECUTE FUNCTION "core_tenancy"."refuse_default_department_change"();
--> statement-breakpoint
ALTER TABLE "core_tenancy"."departments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_tenancy"."departments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_tenancy"."departments"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
