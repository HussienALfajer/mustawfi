-- Custom SQL migration file, put your code below! --
-- Stock belongs to an existing tenant (integrity only); the product foreign keys are
-- tenant-scoped (`0002_stock.sql`).
ALTER TABLE "inventory"."stock_levels" ADD CONSTRAINT "stock_levels_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
-- A level moves with each movement (`moveStock`); only its amount and time change.
GRANT SELECT, INSERT ON "inventory"."stock_levels" TO mustawfi_app;
--> statement-breakpoint
GRANT UPDATE ("on_hand", "updated_at") ON "inventory"."stock_levels" TO mustawfi_app;
--> statement-breakpoint
-- Movements are the record behind the level: never changed or deleted. Corrections are
-- movements of their own.
GRANT SELECT, INSERT ON "inventory"."stock_movements" TO mustawfi_app;
--> statement-breakpoint
CREATE FUNCTION "inventory"."refuse_change"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'stock movements are immutable: % on % refused', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "inventory"."refuse_change"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "stock_movements_immutable" BEFORE UPDATE OR DELETE ON "inventory"."stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "inventory"."refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "stock_movements_no_truncate" BEFORE TRUNCATE ON "inventory"."stock_movements"
  FOR EACH STATEMENT EXECUTE FUNCTION "inventory"."refuse_change"();
--> statement-breakpoint
ALTER TABLE "inventory"."stock_levels" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory"."stock_levels" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "inventory"."stock_levels"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "inventory"."stock_movements"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
