-- Custom SQL migration file, put your code below! --
-- Device revoke (core-foundation slice 9).
ALTER TABLE "core_access"."devices" ADD CONSTRAINT "devices_revoked_by_fk"
  FOREIGN KEY ("tenant_id", "revoked_by") REFERENCES "core_access"."users"("tenant_id", "id");
--> statement-breakpoint
-- Revoking sets the revoke columns; the device reports its wipe; every push or pull records
-- the server's time. Nothing else of a device changes, and a device row is never deleted, so
-- its prefix is never reused (ADR-0020).
GRANT UPDATE ("revoked_at", "revoked_by", "revoke_reason", "wiped_at", "last_sync_at") ON "core_access"."devices" TO mustawfi_app;
--> statement-breakpoint
-- A revoke is final, and so is the wipe it leads to (rule 23): once set, neither is changed
-- or cleared.
CREATE FUNCTION "core_access"."keep_device_revoke"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD."revoked_at" IS NOT NULL AND (
    NEW."revoked_at" IS DISTINCT FROM OLD."revoked_at"
    OR NEW."revoked_by" IS DISTINCT FROM OLD."revoked_by"
    OR NEW."revoke_reason" IS DISTINCT FROM OLD."revoke_reason"
  ) THEN
    RAISE EXCEPTION 'a device revoke is final' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."wiped_at" IS NOT NULL AND NEW."wiped_at" IS DISTINCT FROM OLD."wiped_at" THEN
    RAISE EXCEPTION 'a device wipe is recorded once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "core_access"."keep_device_revoke"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "devices_keep_revoke" BEFORE UPDATE ON "core_access"."devices"
  FOR EACH ROW EXECUTE FUNCTION "core_access"."keep_device_revoke"();
