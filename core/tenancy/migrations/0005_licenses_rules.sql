-- Custom SQL migration file, put your code below! --
-- Licenses are append-only (ADR-0030): read and insert, nothing else. A new license is a new
-- row; the current one is the newest installed.
GRANT SELECT, INSERT ON "core_tenancy"."licenses" TO mustawfi_app;
--> statement-breakpoint
-- The grants keep the app role out; the triggers keep everyone else out too, the owner included.
CREATE FUNCTION "core_tenancy"."refuse_license_change"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'installed licenses are append-only: % refused', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "core_tenancy"."refuse_license_change"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "licenses_append_only" BEFORE UPDATE OR DELETE ON "core_tenancy"."licenses"
  FOR EACH ROW EXECUTE FUNCTION "core_tenancy"."refuse_license_change"();
--> statement-breakpoint
CREATE TRIGGER "licenses_no_truncate" BEFORE TRUNCATE ON "core_tenancy"."licenses"
  FOR EACH STATEMENT EXECUTE FUNCTION "core_tenancy"."refuse_license_change"();
--> statement-breakpoint
ALTER TABLE "core_tenancy"."licenses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_tenancy"."licenses" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_tenancy"."licenses"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
