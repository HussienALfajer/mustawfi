-- Custom SQL migration file, put your code below! --
-- sales depends on core.tenancy, core.access, and inventory: an invoice
-- belongs to an existing tenant and device, and a line names its own tenant's product
-- (integrity only; the product key is tenant-scoped, as a plain one would bypass RLS).
ALTER TABLE "sales"."invoices" ADD CONSTRAINT "invoices_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
ALTER TABLE "sales"."invoices" ADD CONSTRAINT "invoices_device_id_fk"
  FOREIGN KEY ("device_id") REFERENCES "core_access"."devices"("id");
--> statement-breakpoint
ALTER TABLE "sales"."invoice_lines" ADD CONSTRAINT "invoice_lines_product_fk"
  FOREIGN KEY ("tenant_id", "product_id") REFERENCES "inventory"."products"("tenant_id", "id");
--> statement-breakpoint
GRANT USAGE ON SCHEMA "sales" TO mustawfi_app;
--> statement-breakpoint
-- Posted documents are immutable (non-negotiable 6): the app inserts and reads, nothing more.
GRANT SELECT, INSERT ON "sales"."invoices", "sales"."invoice_lines", "sales"."invoice_flags" TO mustawfi_app;
--> statement-breakpoint
-- The grants keep the app role out; the triggers keep everyone else out too, the owner
-- included. Corrections are returns and reversing entries.
CREATE FUNCTION "sales"."refuse_change"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'posted invoices are immutable: % on % refused', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "sales"."refuse_change"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "invoices_immutable" BEFORE UPDATE OR DELETE ON "sales"."invoices"
  FOR EACH ROW EXECUTE FUNCTION "sales"."refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "invoices_no_truncate" BEFORE TRUNCATE ON "sales"."invoices"
  FOR EACH STATEMENT EXECUTE FUNCTION "sales"."refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "invoice_lines_immutable" BEFORE UPDATE OR DELETE ON "sales"."invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION "sales"."refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "invoice_lines_no_truncate" BEFORE TRUNCATE ON "sales"."invoice_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION "sales"."refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "invoice_flags_immutable" BEFORE UPDATE OR DELETE ON "sales"."invoice_flags"
  FOR EACH ROW EXECUTE FUNCTION "sales"."refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "invoice_flags_no_truncate" BEFORE TRUNCATE ON "sales"."invoice_flags"
  FOR EACH STATEMENT EXECUTE FUNCTION "sales"."refuse_change"();
--> statement-breakpoint
-- A line joins only an invoice written in the same transaction: a line appended later would
-- change a posted invoice. As in core_ledger, the invoice's xmin is compared with the
-- top-level transaction id, so invoices must not be written inside a savepoint.
CREATE FUNCTION "sales"."refuse_line_on_posted_invoice"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "sales"."invoices" i
    WHERE i.id = NEW.invoice_id
      AND i.xmin::text::bigint = txid_current() % 4294967296
  ) THEN
    RAISE EXCEPTION 'invoice % is already posted: a line cannot be added', NEW.invoice_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "sales"."refuse_line_on_posted_invoice"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "invoice_lines_only_on_new_invoices" BEFORE INSERT ON "sales"."invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION "sales"."refuse_line_on_posted_invoice"();
--> statement-breakpoint
ALTER TABLE "sales"."invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sales"."invoices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sales"."invoices"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "sales"."invoice_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sales"."invoice_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sales"."invoice_lines"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "sales"."invoice_flags" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sales"."invoice_flags" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sales"."invoice_flags"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
