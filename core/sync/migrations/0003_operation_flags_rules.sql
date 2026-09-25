-- Custom SQL migration file, put your code below! --
-- A flag belongs to an operation of its own tenant. The handler flags an operation before
-- push stores the operation's row in the same transaction, so the check waits for commit.
ALTER TABLE "core_sync"."operation_flags" ADD CONSTRAINT "operation_flags_op_fk"
  FOREIGN KEY ("tenant_id", "op_id") REFERENCES "core_sync"."received_ops"("tenant_id", "id")
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "core_sync"."operation_flags" ADD CONSTRAINT "operation_flags_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
-- Flags are records of what was found on receipt: never changed or deleted.
GRANT SELECT, INSERT ON "core_sync"."operation_flags" TO mustawfi_app;
--> statement-breakpoint
CREATE TRIGGER "operation_flags_immutable" BEFORE UPDATE OR DELETE ON "core_sync"."operation_flags"
  FOR EACH ROW EXECUTE FUNCTION "core_sync"."refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "operation_flags_no_truncate" BEFORE TRUNCATE ON "core_sync"."operation_flags"
  FOR EACH STATEMENT EXECUTE FUNCTION "core_sync"."refuse_change"();
--> statement-breakpoint
ALTER TABLE "core_sync"."operation_flags" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_sync"."operation_flags" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_sync"."operation_flags"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
