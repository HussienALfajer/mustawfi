-- Custom SQL migration file, put your code below! --
-- core.audit depends on core.tenancy: an entry belongs to an existing tenant (integrity only).
ALTER TABLE "core_audit"."entries" ADD CONSTRAINT "entries_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
ALTER TABLE "core_audit"."entries" ADD CONSTRAINT "entries_action_code"
  CHECK ("action" ~ '^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$');
--> statement-breakpoint
GRANT USAGE ON SCHEMA "core_audit" TO mustawfi_app;
--> statement-breakpoint
-- Append-only (non-negotiable 10): read and insert, nothing else.
GRANT SELECT, INSERT ON "core_audit"."entries" TO mustawfi_app;
--> statement-breakpoint
-- The grants keep the app role out; the triggers keep everyone else out too, the owner included.
CREATE FUNCTION "core_audit"."refuse_change"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'the audit log is append-only: % refused', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "core_audit"."refuse_change"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "entries_append_only" BEFORE UPDATE OR DELETE ON "core_audit"."entries"
  FOR EACH ROW EXECUTE FUNCTION "core_audit"."refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "entries_no_truncate" BEFORE TRUNCATE ON "core_audit"."entries"
  FOR EACH STATEMENT EXECUTE FUNCTION "core_audit"."refuse_change"();
--> statement-breakpoint
ALTER TABLE "core_audit"."entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_audit"."entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_audit"."entries"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
