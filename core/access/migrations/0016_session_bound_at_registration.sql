-- Custom SQL migration file, put your code below! --
-- The session that registers a device is bound to it (core-foundation rule 22, QA slice 25), so
-- revoking the device ends it too.
GRANT UPDATE ("device_id") ON "core_access"."sessions" TO mustawfi_app;
--> statement-breakpoint
-- A session is bound once: an unbound session may gain a device, but a bound one never changes
-- or loses it.
CREATE FUNCTION "core_access"."keep_session_device"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD."device_id" IS NOT NULL AND NEW."device_id" IS DISTINCT FROM OLD."device_id" THEN
    RAISE EXCEPTION 'a session is bound to its device once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "core_access"."keep_session_device"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "sessions_keep_device" BEFORE UPDATE ON "core_access"."sessions"
  FOR EACH ROW EXECUTE FUNCTION "core_access"."keep_session_device"();
