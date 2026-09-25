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
import { generateLicenseKeyPair, issueLicense } from "@mustawfi/tools-license";
import { issueTestLicense, testLicensePublicKeys } from "@mustawfi/tools-license/testing";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../db/migrate.ts";
import { migrationSets } from "../db/migration-sets.ts";
import { createLicensedTenant } from "../tenants/licensed-tenant.test-helpers.ts";
import { createTenantCommand } from "./create-tenant.ts";

const PASSWORD = "correct horse battery staple";

let database: TestDatabase;
let superuser: pg.Client;
let appEnv: Record<string, string>;

beforeAll(async () => {
  database = await createTestDatabase("create_tenant");
  await applyMigrations(database.url("owner"), migrationSets);
  superuser = await database.connect("superuser");
  appEnv = {
    DATABASE_URL: database.url("app"),
    LICENSE_PUBLIC_KEYS: await testLicensePublicKeys(),
  };
});

afterAll(() => superuser.end());

interface RunOptions {
  readonly password?: string;
  readonly env?: Record<string, string>;
  /** The license to pass: a fresh test-key license by default, none when `null`. */
  readonly license?: string | null;
}

async function run(args: string[], options: RunOptions = {}) {
  const license = options.license === undefined ? (await issueTestLicense()).jws : options.license;
  let stdout = "";
  let stderr = "";
  const code = await createTenantCommand({
    argv: license === null ? args : [...args, "--license", license],
    env: options.env ?? appEnv,
    stdin: Readable.from([options.password ?? `${PASSWORD}\n`]),
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
    (select count(*)::int from core_tenancy.licenses) as licenses,
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
      department_scope: string;
      role: { name: string; template: string; is_owner: boolean };
      password_hash: string;
    }>(
      `select u.id, u.branch_id, u.login, u.department_scope, u.password_hash,
         json_build_object('name', r.name, 'template', r.template, 'is_owner', r.is_owner) as role
       from core_access.users u join core_access.roles r on r.id = u.role_id
       where u.tenant_id = $1`,
      [created.tenantId],
    );
    expect(owners.rows).toHaveLength(1);
    const owner = owners.rows[0];
    expect(owner).toMatchObject({
      id: created.ownerId,
      branch_id: created.branchId,
      login: "ahmad.owner",
      department_scope: "all",
      role: { name: "المالك", template: "owner", is_owner: true },
    });
    // The owner role and one role per template, with what the modules grant each (slice 5).
    const roles = await superuser.query<{
      name: string;
      template: string;
      is_owner: boolean;
      permissions: string[];
    }>(
      `select r.name, r.template, r.is_owner,
         coalesce(array_agg(p.permission order by p.permission)
           filter (where p.permission is not null), '{}') as permissions
       from core_access.roles r left join core_access.role_permissions p on p.role_id = r.id
       where r.tenant_id = $1 group by r.id order by r.id`,
      [created.tenantId],
    );
    expect(roles.rows).toEqual([
      { name: "المالك", template: "owner", is_owner: true, permissions: [] },
      {
        name: "المحاسب",
        template: "accountant",
        is_owner: false,
        permissions: [
          "access.users.unlock",
          "access.users.view",
          "audit.view",
          "inventory.products.manage",
          "inventory.products.view",
          "sales.invoices.view",
        ],
      },
      {
        name: "كاشير القسم",
        template: "sectionCashier",
        is_owner: false,
        permissions: ["inventory.products.view", "sales.invoice.create"],
      },
      {
        name: "فني الصيانة",
        template: "repairTechnician",
        is_owner: false,
        permissions: ["inventory.products.view"],
      },
      {
        name: "موظف تعبئة الرصيد",
        template: "topUpOperator",
        is_owner: false,
        permissions: ["inventory.products.view"],
      },
    ]);
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
    const result = await run(argv, { password });
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
        `insert into core_access.users (id, tenant_id, branch_id, created_at, created_by, name, login, password_hash, role_id, department_scope)
         select gen_random_uuid(), $1, $2, now(), $1, 'twin', 'ahmad.owner', '$argon2id$x', id, 'all'
         from core_access.roles where tenant_id = $1 and is_owner`,
        [tenantId, branchId],
      ),
    ).toBe("23505");
    // The owner role stays the owner role (rule 14): one per tenant, never archived, and the
    // app cannot change what a role is.
    expect(
      await state(
        `insert into core_access.roles (id, tenant_id, branch_id, created_at, created_by, name, template, is_owner)
         values (gen_random_uuid(), $1, $2, now(), $1, 'second owner', 'owner', true)`,
        [tenantId, branchId],
      ),
    ).toBe("23505");
    expect(
      await state(
        `update core_access.roles set archived_at = now(), archived_by = $1
         where tenant_id = $1 and is_owner`,
        [tenantId],
      ),
    ).toBe("23514");
    expect(
      await state(
        `update core_access.roles set is_owner = false where tenant_id = $1 and is_owner`,
        [tenantId],
      ),
    ).toBe("23514");
    const app = await database.connect("app");
    try {
      await app.query("begin");
      await app.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      const refused = await app
        .query("update core_access.roles set template = null, is_owner = false where is_owner")
        .then(
          () => "ok",
          (error: { code?: string }) => error.code,
        );
      expect(refused).toBe("42501");
      await app.query("rollback");
    } finally {
      await app.end();
    }
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
    const keysOnly = { LICENSE_PUBLIC_KEYS: appEnv["LICENSE_PUBLIC_KEYS"] ?? "" };
    expect((await run(args(), { env: keysOnly })).code).toBe(2);
    // No built-in license key: without configured keys, no tenant is created.
    expect((await run(args(), { env: { DATABASE_URL: database.url("app") } })).code).toBe(2);
    expect((await run(args(), { env: { ...appEnv, LICENSE_PUBLIC_KEYS: "test" } })).code).toBe(2);
  });

  it("refuses to run as a role that can bypass row-level security", async () => {
    await expect(
      run(args(), { env: { ...appEnv, DATABASE_URL: database.url("owner") } }),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("tenant:create and its license", () => {
  it("takes the tenant id from the license and installs it, audited as done by Vertex", async () => {
    const license = await issueTestLicense({ plan: "basic", limits: { users: 8 } });
    const result = await run(args({ name: "مرخّص" }), { license: license.jws });
    expect(result).toMatchObject({ code: 0, stderr: "" });
    const created = JSON.parse(result.stdout) as { tenantId: string; branchId: string };
    expect(created.tenantId).toBe(license.claims.tenant);

    const installed = await superuser.query<{ id: string }>(
      `select id, branch_id, jws, kid, plan, issued_at, expires_at, grace_days, read_only_days,
         max_offline_days, limits, entitlements, installed_by
       from core_tenancy.licenses where tenant_id = $1`,
      [created.tenantId],
    );
    expect(installed.rows).toEqual([
      {
        id: expect.any(String) as string,
        branch_id: created.branchId,
        jws: license.jws,
        kid: "test",
        plan: "basic",
        issued_at: new Date(license.claims.issuedAt),
        expires_at: new Date(license.claims.expiresAt),
        grace_days: 7,
        read_only_days: 30,
        max_offline_days: 10,
        limits: { users: 8, departments: 2, mainPosDevices: 1, companionDevices: 2 },
        entitlements: license.claims.entitlements,
        installed_by: null,
      },
    ]);
    const audit = await superuser.query(
      `select created_by, entity_type, entity_id, before, after from core_audit.entries
       where tenant_id = $1 and action = 'tenancy.license.installed'`,
      [created.tenantId],
    );
    expect(audit.rows).toEqual([
      {
        created_by: null,
        entity_type: "tenancy.license",
        entity_id: installed.rows[0]?.id,
        before: null,
        after: { kid: "test", ...license.claims },
      },
    ]);
  });

  it("refuses a tenant without a license and writes nothing", async () => {
    const before = await countRows();
    const result = await run(args(), { license: null });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("a tenant needs a license");
    expect(await countRows()).toEqual(before);
  });

  it.each([
    [
      "a license signed by another key under the test key id",
      async () => {
        const forger = await generateLicenseKeyPair("test");
        return issueLicense((await issueTestLicense()).claims, forger.privateKey);
      },
      /badSignature/,
    ],
    [
      "a license signed by a key the server does not know",
      async () => {
        const unknown = await generateLicenseKeyPair("2031-1");
        return issueLicense((await issueTestLicense()).claims, unknown.privateKey);
      },
      /unknownKey/,
    ],
    [
      "a license not valid yet",
      async () => {
        const notBefore = new Date(systemClock.now().getTime() + 3_600_000);
        return (await issueTestLicense({ notBefore })).jws;
      },
      /notYetValid/,
    ],
    ["text that is not a license", () => Promise.resolve("not-a-license"), /malformed/],
  ])("refuses %s and writes nothing", async (_, license, reason) => {
    const before = await countRows();
    const result = await run(args(), { license: await license() });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(reason);
    expect(await countRows()).toEqual(before);
  });

  it("refuses a license whose tenant exists: a renewal goes through license:install", async () => {
    const license = await issueTestLicense();
    expect((await run(args(), { license: license.jws })).code).toBe(0);
    const before = await countRows();
    const again = await run(args({ name: "مكرر" }), { license: license.jws });
    expect(again.code).toBe(1);
    expect(again.stderr).toContain("already exists");
    expect(await countRows()).toEqual(before);
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
      return await createLicensedTenant(
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
