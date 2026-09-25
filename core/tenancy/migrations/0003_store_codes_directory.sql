-- Custom SQL migration file, put your code below! --
-- The store-code directory (ADR-0029). `mustawfi_app` gets no privilege on the table: a
-- tenant's row reaches it through the trigger below, and a sign-in reads it through
-- `tenant_for_store_code`, one exact code at a time, so the app role cannot list tenants.
REVOKE ALL ON "core_tenancy"."store_codes" FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "core_tenancy"."publish_store_code"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO "core_tenancy"."store_codes" ("code", "tenant_id") VALUES (NEW."store_code", NEW."id");
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "core_tenancy"."publish_store_code"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "tenants_publish_store_code" AFTER INSERT ON "core_tenancy"."tenants"
  FOR EACH ROW EXECUTE FUNCTION "core_tenancy"."publish_store_code"();
--> statement-breakpoint
-- A store code is never changed, so it is never freed for another tenant.
CREATE FUNCTION "core_tenancy"."refuse_store_code_change"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW."store_code" IS DISTINCT FROM OLD."store_code" THEN
    RAISE EXCEPTION 'a store code never changes' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "core_tenancy"."refuse_store_code_change"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "tenants_keep_store_code" BEFORE UPDATE OF "store_code" ON "core_tenancy"."tenants"
  FOR EACH ROW EXECUTE FUNCTION "core_tenancy"."refuse_store_code_change"();
--> statement-breakpoint
CREATE FUNCTION "core_tenancy"."tenant_for_store_code"(code text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT "tenant_id" FROM "core_tenancy"."store_codes" WHERE "code" = tenant_for_store_code.code
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "core_tenancy"."tenant_for_store_code"(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "core_tenancy"."tenant_for_store_code"(text) TO mustawfi_app;
