import { createTestDatabase, inspectRlsCatalog } from "@mustawfi/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate.ts";
import { migrationSets } from "./migration-sets.ts";
import { rlsFixtureMigrations } from "./test-fixtures/index.ts";

const POLICY = "tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid";
const COLUMNS = "tenant_id uuid not null, branch_id uuid not null";
const NO_TENANT_POLICY =
  "no permissive policy for all commands with the tenant USING and WITH CHECK";

describe("RLS catalog", () => {
  it("finds no problem in the migrated schema", async () => {
    const database = await createTestDatabase("catalog_migrated");
    await applyMigrations(database.url("owner"), [...migrationSets, rlsFixtureMigrations]);

    const superuser = await database.connect("superuser");
    try {
      const catalog = await inspectRlsCatalog(superuser);
      expect(catalog.tables).toContain("rls_fixture.items");
      expect(catalog.problems).toEqual([]);
      // ADR-0029: the store-code directory is the one table outside row-level security, and
      // the app role reaches it only through this lookup. Adding to either list is a decision.
      expect(catalog.sealed).toEqual(["core_tenancy.store_codes"]);
      expect(catalog.definerFunctions).toEqual(["core_tenancy.tenant_for_store_code(code text)"]);
    } finally {
      await superuser.end();
    }
  });

  describe("on fixture violations", () => {
    /** Each fixture table breaks one rule; the SQL runs as the owner in schema `bad`. */
    const violations: Record<string, { sql: string; problems: string[] }> = {
      not_forced: {
        sql: `create table bad.not_forced (${COLUMNS});
          alter table bad.not_forced enable row level security;
          create policy tenant_isolation on bad.not_forced using (${POLICY}) with check (${POLICY});`,
        problems: ["row-level security is not forced"],
      },
      not_enabled: {
        sql: `create table bad.not_enabled (${COLUMNS});
          alter table bad.not_enabled force row level security;
          create policy tenant_isolation on bad.not_enabled using (${POLICY}) with check (${POLICY});`,
        problems: ["row-level security is not enabled"],
      },
      no_policy: {
        sql: `create table bad.no_policy (${COLUMNS});
          alter table bad.no_policy enable row level security;
          alter table bad.no_policy force row level security;`,
        problems: [NO_TENANT_POLICY],
      },
      policy_without_nullif: {
        sql: `create table bad.policy_without_nullif (${COLUMNS});
          alter table bad.policy_without_nullif enable row level security;
          alter table bad.policy_without_nullif force row level security;
          create policy tenant_isolation on bad.policy_without_nullif
            using (tenant_id = current_setting('app.tenant_id', true)::uuid)
            with check (tenant_id = current_setting('app.tenant_id', true)::uuid);`,
        problems: [
          NO_TENANT_POLICY,
          "permissive policy tenant_isolation is not the tenant policy and widens it",
        ],
      },
      policy_without_check: {
        sql: `create table bad.policy_without_check (${COLUMNS});
          alter table bad.policy_without_check enable row level security;
          alter table bad.policy_without_check force row level security;
          create policy tenant_isolation on bad.policy_without_check for select using (${POLICY});`,
        problems: [
          NO_TENANT_POLICY,
          "permissive policy tenant_isolation is not the tenant policy and widens it",
        ],
      },
      extra_permissive_policy: {
        sql: `create table bad.extra_permissive_policy (${COLUMNS});
          alter table bad.extra_permissive_policy enable row level security;
          alter table bad.extra_permissive_policy force row level security;
          create policy tenant_isolation on bad.extra_permissive_policy using (${POLICY}) with check (${POLICY});
          create policy everyone_reads on bad.extra_permissive_policy for select using (true);`,
        problems: ["permissive policy everyone_reads is not the tenant policy and widens it"],
      },
      no_tenant_id: {
        sql: `create table bad.no_tenant_id (branch_id uuid not null);
          alter table bad.no_tenant_id enable row level security;
          alter table bad.no_tenant_id force row level security;`,
        problems: ["tenant_id must be uuid not null", NO_TENANT_POLICY],
      },
      materialized_view: {
        sql: "create materialized view bad.materialized_view as select 1 as tenant_id;",
        problems: ["materialized views and foreign tables cannot enforce row-level security"],
      },
      nullable_branch_id: {
        sql: `create table bad.nullable_branch_id (tenant_id uuid not null, branch_id uuid);
          alter table bad.nullable_branch_id enable row level security;
          alter table bad.nullable_branch_id force row level security;
          create policy tenant_isolation on bad.nullable_branch_id using (${POLICY}) with check (${POLICY});`,
        problems: ["branch_id must be uuid not null"],
      },
    };

    let problemsByTable: Map<string, string[]>;
    let sealed: string[];
    let definerFunctions: string[];

    beforeAll(async () => {
      const database = await createTestDatabase("catalog_violations");
      const owner = await database.connect("owner");
      try {
        await owner.query("create schema bad");
        for (const { sql } of Object.values(violations)) await owner.query(sql);
        // The app role can reach every violation, so each one is checked, not sealed.
        await owner.query("grant select on all tables in schema bad to mustawfi_app");
        // Unreachable by the app role: sealed, whatever it lacks. A definer function the app
        // role may run (PUBLIC keeps EXECUTE by default) is listed.
        await owner.query(`create table bad.sealed (id int);
          create table bad.sealed_but_one_column (id int, secret text);
          grant select (id) on bad.sealed_but_one_column to mustawfi_app;
          create function bad.peek() returns bigint language sql security definer
            as 'select count(*) from bad.sealed';
          create function bad.private_peek() returns bigint language sql security definer
            as 'select count(*) from bad.sealed';
          revoke execute on function bad.private_peek() from public;`);
      } finally {
        await owner.end();
      }
      const superuser = await database.connect("superuser");
      try {
        const catalog = await inspectRlsCatalog(superuser);
        sealed = catalog.sealed.filter((table) => table.startsWith("bad."));
        definerFunctions = catalog.definerFunctions.filter((name) => name.startsWith("bad."));
        problemsByTable = new Map();
        for (const { table, problem } of catalog.problems) {
          problemsByTable.set(table, [...(problemsByTable.get(table) ?? []), problem]);
        }
      } finally {
        await superuser.end();
      }
    });

    it.each(Object.entries(violations))("reports bad.%s", (table, { problems }) => {
      expect(problemsByTable.get(`bad.${table}`)).toEqual(problems);
    });

    it("seals a table the app role holds no privilege on, even on a single column", () => {
      expect(sealed).toEqual(["bad.sealed"]);
      expect(problemsByTable.get("bad.sealed")).toBeUndefined();
      expect(problemsByTable.get("bad.sealed_but_one_column")).toEqual([
        "tenant_id must be uuid not null",
        "branch_id must be uuid not null",
        "row-level security is not enabled",
        "row-level security is not forced",
        NO_TENANT_POLICY,
      ]);
    });

    it("lists the security-definer functions the app role may execute", () => {
      expect(definerFunctions).toEqual(["bad.peek()"]);
    });
  });
});
