-- Custom SQL migration file, put your code below! --
-- core.organization depends on core.tenancy and core.access: a sequence belongs to an existing
-- tenant and device (integrity only).
ALTER TABLE "core_organization"."document_sequences" ADD CONSTRAINT "document_sequences_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
ALTER TABLE "core_organization"."document_sequences" ADD CONSTRAINT "document_sequences_device_id_fk"
  FOREIGN KEY ("device_id") REFERENCES "core_access"."devices"("id");
--> statement-breakpoint
-- Only the last sequence and its time move; the row is never deleted.
GRANT SELECT, INSERT ON "core_organization"."document_sequences" TO mustawfi_app;
--> statement-breakpoint
GRANT UPDATE ("last_seq", "updated_at") ON "core_organization"."document_sequences" TO mustawfi_app;
--> statement-breakpoint
-- The server's view of a device's numbering only moves forward (core-foundation rule 31): a
-- lower sequence would report a gap twice.
CREATE FUNCTION "core_organization"."refuse_sequence_step_back"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW."last_seq" < OLD."last_seq" THEN
    RAISE EXCEPTION 'a document sequence never moves back: % to %', OLD."last_seq", NEW."last_seq"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "core_organization"."refuse_sequence_step_back"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "document_sequences_forward_only" BEFORE UPDATE OF "last_seq" ON "core_organization"."document_sequences"
  FOR EACH ROW EXECUTE FUNCTION "core_organization"."refuse_sequence_step_back"();
--> statement-breakpoint
ALTER TABLE "core_organization"."document_sequences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_organization"."document_sequences" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_organization"."document_sequences"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
