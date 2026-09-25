-- Custom SQL migration file, put your code below! --
-- core.sync depends on core.tenancy and core.access: its rows belong to an existing tenant, and
-- a received operation to an existing device (integrity only).
ALTER TABLE "core_sync"."received_ops" ADD CONSTRAINT "received_ops_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
ALTER TABLE "core_sync"."received_ops" ADD CONSTRAINT "received_ops_device_id_fk"
  FOREIGN KEY ("device_id") REFERENCES "core_access"."devices"("id");
--> statement-breakpoint
ALTER TABLE "core_sync"."changes" ADD CONSTRAINT "changes_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
ALTER TABLE "core_sync"."tenant_counters" ADD CONSTRAINT "tenant_counters_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
GRANT USAGE ON SCHEMA "core_sync" TO mustawfi_app;
--> statement-breakpoint
-- Received operations and changes are records of what happened: never changed or deleted.
GRANT SELECT, INSERT ON "core_sync"."received_ops", "core_sync"."changes" TO mustawfi_app;
--> statement-breakpoint
-- The counter only moves forward, one change at a time (`recordChange`).
GRANT SELECT, INSERT ON "core_sync"."tenant_counters" TO mustawfi_app;
--> statement-breakpoint
GRANT UPDATE ("change_seq") ON "core_sync"."tenant_counters" TO mustawfi_app;
--> statement-breakpoint
-- The grants keep the app role out; the triggers keep everyone else out too, the owner
-- included. An operation's stored result is what a retry is answered with, and the change log
-- is what devices have already applied.
CREATE FUNCTION "core_sync"."refuse_change"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'sync records are append-only: % on % refused', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "core_sync"."refuse_change"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "received_ops_immutable" BEFORE UPDATE OR DELETE ON "core_sync"."received_ops"
  FOR EACH ROW EXECUTE FUNCTION "core_sync"."refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "received_ops_no_truncate" BEFORE TRUNCATE ON "core_sync"."received_ops"
  FOR EACH STATEMENT EXECUTE FUNCTION "core_sync"."refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "changes_immutable" BEFORE UPDATE OR DELETE ON "core_sync"."changes"
  FOR EACH ROW EXECUTE FUNCTION "core_sync"."refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "changes_no_truncate" BEFORE TRUNCATE ON "core_sync"."changes"
  FOR EACH STATEMENT EXECUTE FUNCTION "core_sync"."refuse_change"();
--> statement-breakpoint
ALTER TABLE "core_sync"."received_ops" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_sync"."received_ops" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_sync"."received_ops"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "core_sync"."changes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_sync"."changes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_sync"."changes"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "core_sync"."tenant_counters" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_sync"."tenant_counters" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_sync"."tenant_counters"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
