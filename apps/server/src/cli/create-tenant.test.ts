import { Readable } from "node:stream";
import { verify } from "@node-rs/argon2";
import { currentTenant, openTenantDatabase } from "@mustawfi/core-tenancy/server";
import { createTestDatabase, type TestDatabase } from "@mustawfi/testing";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../db/migrate.ts";
import { migrationSets } from "../db/migration-sets.ts";
import { createTenantCommand } from "./create-tenant.ts";

const PASSWORD = "correct horse battery staple";

let database: TestDatabase;
let superuser: pg.Client;

beforeAll(async () => {
  database = await createTestDatabase("create_tenant");
  await applyMigrations(database.url("owner"), migrationSets);
  superuser = await database.connect("superuser");
});

afterAll(() => superuser.end());

async function run(args: string[], password = `${PASSWORD}\n`, env?: Record<string, string>) {
  let stdout = "";
  let stderr = "";
  const code = await createTenantCommand({
    argv: args,
    env: env ?? { DATABASE_URL: database.url("app") },
    stdin: Readable.from([password]),
    stdout: { write: (text: string) => (stdout += text) },
    stderr: { write: (text: string) => (stderr += text) },
  });
  return { code, stdout, stderr };
}

const args = (overrides: Record<string, string> = {}) =>
  Object.entries({
    name: "متجر النور للموبايلات",
    "base-currency": "SYP",
    "owner-name": "أحمد",
    "owner-login": "Ahmad.Owner",
    ...overrides,
  }).flatMap(([flag, value]) => [`--${flag}`, value]);

async function countRows(): Promise<Record<string, number>> {
  const { rows } = await superuser.query<Record<string, number>>(`select
    (select count(*)::int from core_tenancy.tenants) as tenants,
    (select count(*)::int from core_tenancy.branches) as branches,
    (select count(*)::int from core_access.users) as users`);
  return rows[0] ?? {};
}

describe("tenant:create", () => {
  it("creates a tenant with its hidden default branch, base currency, and owner", async () => {
    const result = await run(args());
    expect(result).toMatchObject({ code: 0, stderr: "" });
    const created = JSON.parse(result.stdout) as {
      tenantId: string;
      branchId: string;
      ownerId: string;
    };

    const tenant = await superuser.query(
      "select id, tenant_id, branch_id, name, base_currency, created_by from core_tenancy.tenants where id = $1",
      [created.tenantId],
    );
    expect(tenant.rows).toEqual([
      {
        id: created.tenantId,
        tenant_id: created.tenantId,
        branch_id: created.branchId,
        name: "متجر النور للموبايلات",
        base_currency: "SYP",
        created_by: created.ownerId,
      },
    ]);

    const branches = await superuser.query(
      "select id, branch_id, is_default from core_tenancy.branches where tenant_id = $1",
      [created.tenantId],
    );
    expect(branches.rows).toEqual([
      { id: created.branchId, branch_id: created.branchId, is_default: true },
    ]);

    const owners = await superuser.query<{
      id: string;
      branch_id: string;
      login: string;
      is_owner: boolean;
      password_hash: string;
    }>(
      "select id, branch_id, login, is_owner, password_hash from core_access.users where tenant_id = $1",
      [created.tenantId],
    );
    expect(owners.rows).toHaveLength(1);
    const owner = owners.rows[0];
    expect(owner).toMatchObject({
      id: created.ownerId,
      branch_id: created.branchId,
      login: "ahmad.owner",
      is_owner: true,
    });
    expect(owner?.password_hash).toMatch(/^\$argon2id\$/);
    expect(await verify(owner?.password_hash ?? "", PASSWORD)).toBe(true);
    expect(await verify(owner?.password_hash ?? "", "wrong password")).toBe(false);
  });

  it("gives each tenant its own rows, visible only in its own context", async () => {
    const first = JSON.parse((await run(args({ name: "الأول" }))).stdout) as { tenantId: string };
    const second = JSON.parse((await run(args({ name: "الثاني" }))).stdout) as {
      tenantId: string;
    };
    expect(first.tenantId).not.toBe(second.tenantId);

    const tenants = await openTenantDatabase({ connectionString: database.url("app") });
    try {
      const seen = await tenants.withTenant({ tenantId: first.tenantId }, currentTenant);
      expect(seen).toMatchObject({ id: first.tenantId, name: "الأول", baseCurrency: "SYP" });
    } finally {
      await tenants.close();
    }
  });

  it.each([
    ["a lower-case currency", args({ "base-currency": "syp" }), `${PASSWORD}\n`],
    ["a currency that is not three letters", args({ "base-currency": "SY" }), `${PASSWORD}\n`],
    ["an empty tenant name", args({ name: "  " }), `${PASSWORD}\n`],
    ["an invalid login", args({ "owner-login": "a b" }), `${PASSWORD}\n`],
    ["a short password", args(), "short\n"],
    ["a missing owner", args().slice(0, 4), `${PASSWORD}\n`],
  ])("refuses %s and writes nothing", async (_, argv, password) => {
    const before = await countRows();
    const result = await run(argv, password);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("usage:");
    expect(await countRows()).toEqual(before);
  });

  it("keeps one default branch per tenant, unique logins, and a real default branch", async () => {
    const { tenantId, branchId } = JSON.parse((await run(args({ name: "قيود" }))).stdout) as {
      tenantId: string;
      branchId: string;
    };
    const state = (sql: string, params: unknown[]) =>
      superuser.query(sql, params).then(
        () => "ok",
        (error: { code?: string }) => error.code,
      );
    expect(
      await state(
        `insert into core_tenancy.branches (id, tenant_id, branch_id, created_at, created_by, name, is_default)
         select b, $1, b, now(), $1, 'second', true from (select gen_random_uuid() as b) x`,
        [tenantId],
      ),
    ).toBe("23505");
    expect(
      await state(
        `insert into core_access.users (id, tenant_id, branch_id, created_at, created_by, name, login, password_hash, is_owner)
         values (gen_random_uuid(), $1, $2, now(), $1, 'twin', 'ahmad.owner', '$argon2id$x', false)`,
        [tenantId, branchId],
      ),
    ).toBe("23505");
    // The deferred FK fires at commit: a tenant pointing at a missing branch never commits.
    expect(
      await state(
        `insert into core_tenancy.tenants (id, tenant_id, branch_id, created_at, created_by, name, base_currency)
         select t, t, gen_random_uuid(), now(), t, 'orphan', 'SYP' from (select gen_random_uuid() as t) x`,
        [],
      ),
    ).toBe("23503");
  });

  it("refuses an unknown flag or a missing database URL as bad usage", async () => {
    expect((await run([...args(), "--tenant-id", "x"])).code).toBe(2);
    expect((await run(args(), `${PASSWORD}\n`, {})).code).toBe(2);
  });

  it("refuses to run as a role that can bypass row-level security", async () => {
    await expect(
      run(args(), `${PASSWORD}\n`, { DATABASE_URL: database.url("owner") }),
    ).rejects.toThrow(/row-level security/);
  });
});
