import { Readable } from "node:stream";
import { verify } from "@node-rs/argon2";
import { currentTenant, openTenantDatabase } from "@mustawfi/core-tenancy/server";
import {
  cryptoRandom,
  type RandomSource,
  systemClock,
  UNAMBIGUOUS_ALPHABET,
  uuidV7Generator,
} from "@mustawfi/kernel";
import { createTestDatabase, sqlState, type TestDatabase } from "@mustawfi/testing";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../db/migrate.ts";
import { migrationSets } from "../db/migration-sets.ts";
import { createTenantWithOwner } from "../tenants/create-tenant.ts";
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
    (select count(*)::int from core_access.users) as users,
    (select count(*)::int from core_tenancy.store_codes) as store_codes,
    (select count(*)::int from core_ledger.accounts) as accounts,
    (select count(*)::int from core_audit.entries) as audit_entries`);
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
      storeCode: string;
    };
    expect(created.storeCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    const tenant = await superuser.query(
      "select id, tenant_id, branch_id, name, base_currency, store_code, created_by from core_tenancy.tenants where id = $1",
      [created.tenantId],
    );
    expect(tenant.rows).toEqual([
      {
        id: created.tenantId,
        tenant_id: created.tenantId,
        branch_id: created.branchId,
        name: "متجر النور للموبايلات",
        base_currency: "SYP",
        store_code: created.storeCode,
        created_by: created.ownerId,
      },
    ]);
    const directory = await superuser.query(
      "select code, tenant_id from core_tenancy.store_codes where tenant_id = $1",
      [created.tenantId],
    );
    expect(directory.rows).toEqual([{ code: created.storeCode, tenant_id: created.tenantId }]);

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

    const accounts = await superuser.query(
      "select code, kind, system_key, branch_id, created_by from core_ledger.accounts where tenant_id = $1 order by code",
      [created.tenantId],
    );
    const standard = { branch_id: created.branchId, created_by: created.ownerId };
    expect(accounts.rows).toEqual([
      { code: "1100", kind: "asset", system_key: "cash", ...standard },
      { code: "4100", kind: "revenue", system_key: "salesRevenue", ...standard },
      { code: "5900", kind: "expense", system_key: "roundingDifferences", ...standard },
    ]);
    const seeded = await superuser.query(
      "select created_by from core_audit.entries where tenant_id = $1 and action = 'ledger.accounts.seeded'",
      [created.tenantId],
    );
    expect(seeded.rows).toEqual([{ created_by: created.ownerId }]);
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
        `insert into core_tenancy.tenants (id, tenant_id, branch_id, created_at, created_by, name, base_currency, store_code)
         select t, t, gen_random_uuid(), now(), t, 'orphan', 'SYP', 'XRPHAN' from (select gen_random_uuid() as t) x`,
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

describe("store codes", () => {
  const newId = uuidV7Generator({ clock: systemClock, random: cryptoRandom });

  /** Randomness whose first store-code draws spell `codes`; real randomness otherwise. */
  function drawing(...codes: string[]): RandomSource {
    const queue = [...codes];
    return {
      bytes: (length) => {
        const code = length === 6 ? queue.shift() : undefined;
        if (code === undefined) return cryptoRandom.bytes(length);
        return Uint8Array.from(code, (symbol) => UNAMBIGUOUS_ALPHABET.indexOf(symbol));
      },
    };
  }

  async function create(random: RandomSource) {
    const tenants = await openTenantDatabase({ connectionString: database.url("app") });
    try {
      return await createTenantWithOwner(
        tenants,
        {
          name: "رمز",
          baseCurrency: "USD",
          ownerName: "مالك",
          ownerLogin: "owner",
          ownerPassword: PASSWORD,
        },
        { clock: systemClock, newId, random },
      );
    } finally {
      await tenants.close();
    }
  }

  it("resolve to their tenant as typed, and to nothing when unknown or malformed", async () => {
    const created = await create(cryptoRandom);
    const tenants = await openTenantDatabase({ connectionString: database.url("app") });
    try {
      const code = created.storeCode;
      expect(await tenants.resolveStoreCode(code)).toBe(created.tenantId);
      expect(
        await tenants.resolveStoreCode(` ${code.slice(0, 2).toLowerCase()}-${code.slice(2)}`),
      ).toBe(created.tenantId);
      const unknown = code === "ZZZZZZ" ? "YYYYYY" : "ZZZZZZ";
      expect(await tenants.resolveStoreCode(unknown)).toBeUndefined();
      for (const malformed of ["", "ABCDE", "ABCDEFG", "ABCDE1", "' or 1=1 --"]) {
        expect(await tenants.resolveStoreCode(malformed)).toBeUndefined();
      }
    } finally {
      await tenants.close();
    }
  });

  it("are drawn again when another tenant holds the code, up to five times", async () => {
    const first = await create(cryptoRandom);
    const second = await create(drawing(first.storeCode, first.storeCode));
    expect(second.storeCode).not.toBe(first.storeCode);

    const before = await countRows();
    await expect(create(drawing(...Array<string>(5).fill(first.storeCode)))).rejects.toSatisfy(
      (error: unknown) => sqlState(error) === "23505",
    );
    expect(await countRows()).toEqual(before);
  });

  it("keep the directory sealed from the app role and never change", async () => {
    const created = await create(cryptoRandom);
    const app = await database.connect("app");
    try {
      for (const statement of [
        "select * from core_tenancy.store_codes",
        "insert into core_tenancy.store_codes values ('ABCDEF', gen_random_uuid())",
        "select core_tenancy.publish_store_code()",
      ]) {
        const outcome = await app.query(statement).then(
          () => "allowed",
          (error: unknown) => sqlState(error),
        );
        expect(outcome, statement).toBe("42501");
      }
    } finally {
      await app.end();
    }
    const changed = await superuser
      .query("update core_tenancy.tenants set store_code = 'ABCDEF' where id = $1", [
        created.tenantId,
      ])
      .then(
        () => "changed",
        (error: { code?: string }) => error.code,
      );
    expect(changed).toBe("23514");
  });
});
