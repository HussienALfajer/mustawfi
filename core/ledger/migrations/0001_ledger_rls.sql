-- Custom SQL migration file, put your code below! --
-- core.ledger depends on core.tenancy: accounts and entries belong to an existing tenant
-- (integrity only). Lines reach the tenant through their entry's tenant-scoped foreign key.
ALTER TABLE "core_ledger"."accounts" ADD CONSTRAINT "accounts_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
ALTER TABLE "core_ledger"."journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "core_tenancy"."tenants"("id");
--> statement-breakpoint
GRANT USAGE ON SCHEMA "core_ledger" TO mustawfi_app;
--> statement-breakpoint
-- Nothing in the ledger is ever changed or deleted by the app (non-negotiables 5 and 6);
-- editing the chart of accounts grants what it needs when it comes.
GRANT SELECT, INSERT ON "core_ledger"."accounts", "core_ledger"."journal_entries", "core_ledger"."journal_lines" TO mustawfi_app;
--> statement-breakpoint
-- Every entry is posted when it is written, so a written entry or line is final. The grants
-- keep the app role out; the triggers keep everyone else out too, the owner included.
-- Corrections are reversing entries (ADR-0006).
CREATE FUNCTION "core_ledger"."refuse_change"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'posted journal entries are immutable: % on % refused', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "core_ledger"."refuse_change"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "journal_entries_immutable" BEFORE UPDATE OR DELETE ON "core_ledger"."journal_entries"
  FOR EACH ROW EXECUTE FUNCTION "core_ledger"."refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "journal_entries_no_truncate" BEFORE TRUNCATE ON "core_ledger"."journal_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION "core_ledger"."refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "journal_lines_immutable" BEFORE UPDATE OR DELETE ON "core_ledger"."journal_lines"
  FOR EACH ROW EXECUTE FUNCTION "core_ledger"."refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "journal_lines_no_truncate" BEFORE TRUNCATE ON "core_ledger"."journal_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION "core_ledger"."refuse_change"();
--> statement-breakpoint
-- A line joins only an entry written in the same transaction: appending even a balanced pair
-- to an entry committed earlier would change a posted entry. The entry's xmin is compared with
-- the top-level transaction id, so entries and their lines must not be written inside a
-- savepoint (a false refusal, never a silent change).
CREATE FUNCTION "core_ledger"."refuse_line_on_posted_entry"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "core_ledger"."journal_entries" e
    WHERE e.id = NEW.journal_entry_id
      AND e.xmin::text::bigint = txid_current() % 4294967296
  ) THEN
    RAISE EXCEPTION 'journal entry % is already posted: a line cannot be added', NEW.journal_entry_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "core_ledger"."refuse_line_on_posted_entry"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "journal_lines_only_on_new_entries" BEFORE INSERT ON "core_ledger"."journal_lines"
  FOR EACH ROW EXECUTE FUNCTION "core_ledger"."refuse_line_on_posted_entry"();
--> statement-breakpoint
-- An entry balances (non-negotiable 5): at commit, each entry written in the transaction has at
-- least two lines and its debits equal its credits, however its rows were inserted. Runs as the
-- writer, under row-level security: the entry and its lines are the writer's own tenant's.
CREATE FUNCTION "core_ledger"."assert_entry_balanced"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  entry_id uuid;
  line_count bigint;
  debits numeric;
  credits numeric;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    entry_id := NEW.id;
  ELSE
    entry_id := NEW.journal_entry_id;
  END IF;
  SELECT count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    INTO line_count, debits, credits
    FROM "core_ledger"."journal_lines" WHERE journal_entry_id = entry_id;
  IF line_count < 2 OR debits <> credits THEN
    RAISE EXCEPTION 'journal entry % does not balance: % lines, debits %, credits %',
      entry_id, line_count, debits, credits
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "core_ledger"."assert_entry_balanced"() FROM PUBLIC;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "journal_entries_balanced" AFTER INSERT ON "core_ledger"."journal_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "core_ledger"."assert_entry_balanced"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "journal_lines_balanced" AFTER INSERT ON "core_ledger"."journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "core_ledger"."assert_entry_balanced"();
--> statement-breakpoint
ALTER TABLE "core_ledger"."accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_ledger"."accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_ledger"."accounts"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "core_ledger"."journal_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_ledger"."journal_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_ledger"."journal_entries"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "core_ledger"."journal_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "core_ledger"."journal_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "core_ledger"."journal_lines"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
