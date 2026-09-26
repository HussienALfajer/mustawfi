-- Custom SQL migration file, put your code below! --
-- core.sync depends on core.tenancy and core.access: a bundle version belongs to an existing
-- tenant and device (integrity only).
ALTER TABLE "core_sync"."bundle_versions" ADD CONSTRAINT "bundle_versions_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
ALTER TABLE "core_sync"."bundle_versions" ADD CONSTRAINT "bundle_versions_device_id_fk"
  FOREIGN KEY ("device_id") REFERENCES "core_access"."devices"("id");
--> statement-breakpoint
-- Only the version, its digest, and its issue time move; the row is never deleted.
GRANT SELECT, INSERT ON "core_sync"."bundle_versions" TO mustawfi_app;
--> statement-breakpoint
GRANT UPDATE ("version", "digest", "issued_at") ON "core_sync"."bundle_versions" TO mustawfi_app;
--> statement-breakpoint
-- A device refuses a bundle older than the one it holds (core-foundation rule 11), so a version
-- never moves back.
CREATE FUNCTION "core_sync"."refuse_bundle_version_step_back"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW."version" < OLD."version" THEN
    RAISE EXCEPTION 'a bundle version never moves back: % to %', OLD."version", NEW."version"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "core_sync"."refuse_bundle_version_step_back"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "bundle_versions_forward_only" BEFORE UPDATE OF "version" ON "core_sync"."bundle_versions"
  FOR EACH ROW EXECUTE FUNCTION "core_sync"."refuse_bundle_version_step_back"();
--> statement-breakpoint
ALTER TABLE "core_sync"."bundle_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_sync"."bundle_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_sync"."bundle_versions"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
