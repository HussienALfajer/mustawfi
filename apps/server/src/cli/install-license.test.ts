import {
  currentLicense,
  openTenantDatabase,
  type TenantDatabase,
} from "@mustawfi/core-tenancy/server";
import { cryptoRandom, systemClock, uuidV7Generator } from "@mustawfi/kernel";
import { createTestDatabase, sqlState, type TestDatabase } from "@mustawfi/testing";
import { generateLicenseKeyPair, issueLicense } from "@mustawfi/tools-license";
import {
  issueTestLicense,
  testLicenseKeys,
  testLicensePublicKeys,
} from "@mustawfi/tools-license/testing";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../db/migrate.ts";
import { migrationSets } from "../db/migration-sets.ts";
import type { CreatedTenant } from "../tenants/create-tenant.ts";
import { installTenantLicense } from "../tenants/install-license.ts";
import { createLicensedTenant } from "../tenants/licensed-tenant.test-helpers.ts";
import { installLicenseCommand } from "./install-license.ts";

const HOUR = 3_600_000;
const newId = uuidV7Generator({ clock: systemClock, random: cryptoRandom });

let database: TestDatabase;
let tenants: TenantDatabase;
let superuser: pg.Client;
let appEnv: Record<string, string>;
let store: CreatedTenant;
let other: CreatedTenant;

/** An instant `hours` from now; licenses must be issued after the installed one. */
const fromNow = (hours: number) => new Date(systemClock.now().getTime() + hours * HOUR);

async function newStore(name: string): Promise<CreatedTenant> {
  return createLicensedTenant(
    tenants,
    {
      name,
      baseCurrency: "SYP",
      ownerName: "أحمد",
      ownerLogin: "ahmad",
      ownerPassword: "correct horse battery staple",
    },
    { clock: systemClock, newId, random: cryptoRandom },
    // Issued an hour ago, so each test's license, issued now, is newer.
    { issuedAt: fromNow(-1) },
  );
}

beforeAll(async () => {
  database = await createTestDatabase("install_license");
  await applyMigrations(database.url("owner"), migrationSets);
  tenants = await openTenantDatabase({ connectionString: database.url("app") });
  superuser = await database.connect("superuser");
  appEnv = {
    DATABASE_URL: database.url("app"),
    LICENSE_PUBLIC_KEYS: await testLicensePublicKeys(),
  };
  store = await newStore("متجر النور");
  other = await newStore("متجر آخر");
});

afterAll(async () => {
  await superuser.end();
  await tenants.close();
});

async function install(storeCode: string, license: string, env = appEnv) {
  let stdout = "";
  let stderr = "";
  const code = await installLicenseCommand({
    argv: ["--store", storeCode, "--license", license],
    env,
    stdout: { write: (text: string) => (stdout += text) },
    stderr: { write: (text: string) => (stderr += text) },
  });
  return { code, stdout, stderr };
}

const installed = (tenant: CreatedTenant) =>
  tenants.withTenant({ tenantId: tenant.tenantId }, currentLicense);

async function licenseCount(): Promise<number> {
  const { rows } = await superuser.query<{ count: number }>(
    "select count(*)::int as count from core_tenancy.licenses",
  );
  return rows[0]?.count ?? 0;
}

describe("license:install", () => {
  it("installs a newer license, which becomes current, audited with the one it replaces", async () => {
    const previous = await installed(store);
    const renewal = await issueTestLicense({
      tenant: store.tenantId,
      plan: "phonesPro",
      limits: { users: 10 },
      expiresAt: new Date("2028-01-01T00:00:00Z"),
    });
    const result = await install(store.storeCode.toLowerCase(), renewal.jws);
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({ kid: "test", ...renewal.claims });

    const current = await installed(store);
    expect(current?.claims).toEqual(renewal.claims);
    expect(current?.id).not.toBe(previous?.id);

    const audit = await superuser.query(
      `select created_by, entity_id, before, after from core_audit.entries
       where tenant_id = $1 and action = 'tenancy.license.installed' order by created_at`,
      [store.tenantId],
    );
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows[1]).toEqual({
      created_by: null,
      entity_id: current?.id,
      before: { kid: "test", ...previous?.claims },
      after: { kid: "test", ...renewal.claims },
    });
  });

  it.each([
    [
      "a signature by another key under the test key id",
      async () => {
        const forger = await generateLicenseKeyPair("test");
        const { claims } = await issueTestLicense({ tenant: store.tenantId });
        return issueLicense(claims, forger.privateKey);
      },
      "badSignature",
    ],
    [
      "a key id the server does not know",
      async () => {
        const unknown = await generateLicenseKeyPair("2031-1");
        const { claims } = await issueTestLicense({ tenant: store.tenantId });
        return issueLicense(claims, unknown.privateKey);
      },
      "unknownKey",
    ],
    [
      "a license for another tenant",
      async () => (await issueTestLicense({ tenant: other.tenantId })).jws,
      "otherTenant",
    ],
    [
      "a license issued before the installed one",
      async () => (await issueTestLicense({ tenant: store.tenantId, issuedAt: fromNow(-2) })).jws,
      "notNewer",
    ],
    [
      "a license whose validity starts in the future",
      async () => (await issueTestLicense({ tenant: store.tenantId, notBefore: fromNow(1) })).jws,
      "notYetValid",
    ],
  ])("refuses %s and installs nothing", async (_, license, reason) => {
    const before = { count: await licenseCount(), current: await installed(store) };
    const result = await install(store.storeCode, await license());
    expect(result).toMatchObject({ code: 1, stdout: "" });
    expect(result.stderr).toContain(`(${reason})`);
    expect({ count: await licenseCount(), current: await installed(store) }).toEqual(before);
  });

  it("keeps the license issued last as current when the server clock steps back", async () => {
    const renewal = await issueTestLicense({ tenant: store.tenantId, notBefore: fromNow(-48) });
    const pastClock = { now: () => fromNow(-24) };
    await installTenantLicense(
      tenants,
      { storeCode: store.storeCode, license: renewal.jws },
      { clock: pastClock, newId, licenseKeys: await testLicenseKeys() },
    );
    expect((await installed(store))?.claims).toEqual(renewal.claims);
  });

  it("refuses the installed license a second time", async () => {
    const renewal = await issueTestLicense({ tenant: store.tenantId });
    expect((await install(store.storeCode, renewal.jws)).code).toBe(0);
    const count = await licenseCount();
    const again = await install(store.storeCode, renewal.jws);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain("(notNewer)");
    expect(await licenseCount()).toBe(count);
  });

  it("refuses an unknown store, and runs only with its keys and database configured", async () => {
    const license = (await issueTestLicense({ tenant: store.tenantId })).jws;
    expect((await install("ZZZZZZ", license)).code).toBe(1);
    expect(
      (await install(store.storeCode, license, { DATABASE_URL: appEnv["DATABASE_URL"] ?? "" }))
        .code,
    ).toBe(2);
    expect(
      (
        await install(store.storeCode, license, {
          LICENSE_PUBLIC_KEYS: appEnv["LICENSE_PUBLIC_KEYS"] ?? "",
        })
      ).code,
    ).toBe(2);
    const noLicense = await installLicenseCommand({
      argv: ["--store", store.storeCode],
      env: appEnv,
      stdout: { write: () => true },
      stderr: { write: () => true },
    });
    expect(noLicense).toBe(2);
  });
});

describe("installed licenses", () => {
  it("are append-only: the app role cannot change or delete, and a trigger stops everyone else", async () => {
    const app = await database.connect("app");
    try {
      await app.query("select set_config('app.tenant_id', $1, false)", [store.tenantId]);
      for (const statement of [
        "update core_tenancy.licenses set plan = 'gold'",
        "delete from core_tenancy.licenses",
        "truncate core_tenancy.licenses",
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
    for (const statement of [
      "update core_tenancy.licenses set plan = 'gold'",
      "delete from core_tenancy.licenses",
      "truncate core_tenancy.licenses",
    ]) {
      const outcome = await superuser.query(statement).then(
        () => "allowed",
        (error: { code?: string; message?: string }) =>
          `${error.code ?? ""} ${error.message ?? ""}`,
      );
      expect(outcome, statement).toMatch(/^42501 installed licenses are append-only/);
    }
  });
});
