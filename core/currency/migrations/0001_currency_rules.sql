-- Custom SQL migration file, put your code below! --
-- core.currency depends on core.tenancy: its rows belong to an existing tenant (integrity only).
-- Settings and rates reach the tenant through their tenant-scoped foreign keys to
-- tenant_currencies.
ALTER TABLE "core_currency"."tenant_currencies" ADD CONSTRAINT "tenant_currencies_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
GRANT USAGE ON SCHEMA "core_currency" TO mustawfi_app;
--> statement-breakpoint
-- A tenant's currencies and settings are seeded with it and edited, never deleted; the code of a
-- currency never changes.
GRANT SELECT, INSERT ON "core_currency"."tenant_currencies", "core_currency"."currency_settings" TO mustawfi_app;
--> statement-breakpoint
GRANT UPDATE ("enabled", "cash_rounding_step", "updated_at", "updated_by") ON "core_currency"."tenant_currencies" TO mustawfi_app;
--> statement-breakpoint
GRANT UPDATE ("change_currency", "rate_change_threshold_percent", "updated_at", "updated_by") ON "core_currency"."currency_settings" TO mustawfi_app;
--> statement-breakpoint
-- Rates are append-only (core-money rule 8): a rate that arrives late is history, never an
-- update. The grant keeps the app role out; the triggers keep everyone else out too, the owner
-- included.
GRANT SELECT, INSERT ON "core_currency"."exchange_rates" TO mustawfi_app;
--> statement-breakpoint
CREATE FUNCTION "core_currency"."refuse_rate_change"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'exchange rates are append-only: % on % refused', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "core_currency"."refuse_rate_change"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "exchange_rates_append_only" BEFORE UPDATE OR DELETE ON "core_currency"."exchange_rates"
  FOR EACH ROW EXECUTE FUNCTION "core_currency"."refuse_rate_change"();
--> statement-breakpoint
CREATE TRIGGER "exchange_rates_no_truncate" BEFORE TRUNCATE ON "core_currency"."exchange_rates"
  FOR EACH STATEMENT EXECUTE FUNCTION "core_currency"."refuse_rate_change"();
--> statement-breakpoint
ALTER TABLE "core_currency"."tenant_currencies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_currency"."tenant_currencies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_currency"."tenant_currencies"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "core_currency"."currency_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_currency"."currency_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_currency"."currency_settings"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "core_currency"."exchange_rates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_currency"."exchange_rates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_currency"."exchange_rates"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
