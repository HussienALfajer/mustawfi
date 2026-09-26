import { createHash } from "node:crypto";
import { accessProblemCodes } from "@mustawfi/core-access/shared";
import { problemDetailsSchema } from "@mustawfi/core-config/shared";
import { openTenantDatabase, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import { cryptoRandom, manualClock, systemClock, uuidV7Generator } from "@mustawfi/kernel";
import { createTestDatabase, type TestDatabase } from "@mustawfi/testing";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../db/migrate.ts";
import { migrationSets } from "../db/migration-sets.ts";
import { buildHostServer } from "../host-server.ts";
import { createServerRegistry } from "../modules.ts";
import { createStaffUser } from "../staff.test-helpers.ts";
import type { CreatedTenant } from "../tenants/create-tenant.ts";
import { createLicensedTenant } from "../tenants/licensed-tenant.test-helpers.ts";
import { resetCodeCommand } from "./reset-code.ts";
import { testTotpKeys } from "../totp-keys.test-helpers.ts";

/**
 * `access:reset-code` and `POST /api/v1/access/password-reset` (`core-foundation` rule 27).
 * The CLI runs on the system clock, so the server's manual clock starts at the system's time.
 */

const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a brand new long password";
const MINUTE = 60_000;
const clock = manualClock(systemClock.now());
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const dependencies = { clock, newId, random: cryptoRandom };

let database: TestDatabase;
let tenants: TenantDatabase;
let server: FastifyInstance;
let superuser: pg.Client;
let env: Record<string, string>;
let addressCounter = 0;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function newTenant(name: string): Promise<CreatedTenant> {
  return createLicensedTenant(
    tenants,
    { name, baseCurrency: "SYP", ownerName: "أحمد", ownerLogin: "ahmad", ownerPassword: PASSWORD },
    dependencies,
  );
}

beforeAll(async () => {
  database = await createTestDatabase("reset_code");
  await applyMigrations(database.url("owner"), migrationSets);
  tenants = await openTenantDatabase({ connectionString: database.url("app") });
  superuser = await database.connect("superuser");
  env = { DATABASE_URL: database.url("app") };
  server = await buildHostServer({
    registry: createServerRegistry(),
    services: { tenants, ...dependencies, totpKeys: testTotpKeys },
  });
});

afterAll(async () => {
  await server.close();
  await superuser.end();
  await tenants.close();
});

async function resetCode(argv: readonly string[]) {
  let stdout = "";
  let stderr = "";
  const code = await resetCodeCommand({
    argv,
    env,
    stdout: { write: (text: string) => (stdout += text) },
    stderr: { write: (text: string) => (stderr += text) },
  });
  return { code, stdout, stderr };
}

async function issue(tenant: CreatedTenant, login = "ahmad") {
  const result = await resetCode([
    "--store",
    tenant.storeCode,
    "--login",
    login,
    "--staff",
    "Hussien",
  ]);
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout) as { code: string; expiresAt: string; userId: string };
}

function reset(body: Record<string, string>) {
  addressCounter += 1;
  return server.inject({
    method: "POST",
    url: "/api/v1/access/password-reset",
    remoteAddress: `198.51.100.${String(addressCounter)}`,
    payload: body,
  });
}

function logIn(tenant: CreatedTenant, password: string, login = "ahmad") {
  return server.inject({
    method: "POST",
    url: "/api/v1/access/login",
    payload: { storeCode: tenant.storeCode, login, password },
  });
}

function expectProblem(
  response: { statusCode: number; json(): unknown },
  status: number,
  code: string,
) {
  expect(response.statusCode).toBe(status);
  expect(problemDetailsSchema.parse(response.json())).toMatchObject({ status, code });
}

async function auditOf(tenantId: string, action: string) {
  const { rows } = await superuser.query<{
    created_by: string | null;
    entity_id: string | null;
    after: Record<string, unknown> | null;
  }>(
    `select created_by, entity_id, after from core_audit.entries
     where tenant_id = $1 and action = $2 order by created_at, id`,
    [tenantId, action],
  );
  return rows;
}

describe("access:reset-code", () => {
  it("prints a thirty-minute code for an owner, stores only its hash, and audits it as support", async () => {
    const tenant = await newTenant("متجر الاستعادة");
    const before = systemClock.now().getTime();
    const issued = await issue(tenant);
    expect(issued.code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    expect(issued.userId).toBe(tenant.ownerId);
    const lifetime = new Date(issued.expiresAt).getTime() - before;
    expect(lifetime).toBeGreaterThanOrEqual(30 * MINUTE);
    expect(lifetime).toBeLessThan(31 * MINUTE);

    const { rows } = await superuser.query<{
      id: string;
      created_by: string | null;
      issued_by_support: boolean;
      issued_by: string;
    }>(
      `select id, created_by, issued_by_support, issued_by from core_access.reset_codes
       where tenant_id = $1 and code_hash = $2`,
      [tenant.tenantId, sha256(issued.code.replace("-", ""))],
    );
    expect(rows).toMatchObject([
      { created_by: null, issued_by_support: true, issued_by: "Hussien" },
    ]);
    expect(await auditOf(tenant.tenantId, "access.resetCode.issued")).toMatchObject([
      {
        created_by: null,
        entity_id: tenant.ownerId,
        after: {
          resetCodeId: rows[0]?.id,
          expiresAt: issued.expiresAt,
          issuedBy: "support",
          staff: "Hussien",
        },
      },
    ]);
  });

  it("refuses an unknown store, an unknown login, and a user who is not an owner", async () => {
    const tenant = await newTenant("متجر الرفض");
    await createStaffUser(tenants, tenant, { login: "samer", permissions: [] }, dependencies);
    for (const [store, login] of [
      ["ZZZZ22", "ahmad"],
      [tenant.storeCode, "nobody"],
      [tenant.storeCode, "samer"],
    ] as const) {
      const result = await resetCode(["--store", store, "--login", login, "--staff", "Hussien"]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
    }
    const { rows } = await superuser.query(
      "select 1 from core_access.reset_codes where tenant_id = $1",
      [tenant.tenantId],
    );
    expect(rows).toHaveLength(0);
  });

  it("needs the store, the login, the staff member, and the database", async () => {
    expect((await resetCode(["--store", "ABCDEF", "--login", "ahmad"])).code).toBe(2);
    expect((await resetCode(["--bogus"])).code).toBe(2);
    const noDatabase = await resetCodeCommand({
      argv: ["--store", "ABCDEF", "--login", "ahmad", "--staff", "Hussien"],
      env: {},
      stdout: { write: () => true },
      stderr: { write: () => true },
    });
    expect(noDatabase).toBe(2);
  });
});

describe("password reset with a support code", () => {
  it("sets the owner's new password and PIN once, ends their sessions, and audits it", async () => {
    const tenant = await newTenant("متجر كلمة المرور");
    const oldSession = (await logIn(tenant, PASSWORD)).json<{ token: string }>().token;
    const { code } = await issue(tenant);

    const answer = await reset({
      storeCode: tenant.storeCode,
      login: "AHMAD",
      code: code.toLowerCase(),
      password: NEW_PASSWORD,
      pin: "2580",
    });
    expect(answer.statusCode).toBe(204);

    expectProblem(await logIn(tenant, PASSWORD), 401, accessProblemCodes.loginFailed);
    expect((await logIn(tenant, NEW_PASSWORD)).statusCode).toBe(200);
    expectProblem(
      await server.inject({
        method: "GET",
        url: "/api/v1/access/session",
        headers: { authorization: `Bearer ${oldSession}` },
      }),
      401,
      accessProblemCodes.sessionRequired,
    );

    // Works once.
    expectProblem(
      await reset({ storeCode: tenant.storeCode, login: "ahmad", code, password: PASSWORD }),
      401,
      accessProblemCodes.resetCodeInvalid,
    );
    expect((await logIn(tenant, NEW_PASSWORD)).statusCode).toBe(200);

    const { rows } = await superuser.query<{ pin_verifier: string | null }>(
      "select pin_verifier from core_access.users where id = $1",
      [tenant.ownerId],
    );
    expect(rows[0]?.pin_verifier).toMatch(/^\$argon2id\$/);
    expect(await auditOf(tenant.tenantId, "access.user.passwordReset")).toMatchObject([
      {
        created_by: tenant.ownerId,
        entity_id: tenant.ownerId,
        after: { hasPassword: true, hasPin: true, issuedBy: "support" },
      },
    ]);
    expect(
      (await auditOf(tenant.tenantId, "access.session.revoked")).some(
        (entry) => entry.created_by === tenant.ownerId,
      ),
    ).toBe(true);
  });

  it("expires after thirty minutes", async () => {
    const tenant = await newTenant("متجر المهلة");
    const { code } = await issue(tenant);
    clock.set(new Date(systemClock.now().getTime() + 30 * MINUTE + 1000));
    try {
      expectProblem(
        await reset({ storeCode: tenant.storeCode, login: "ahmad", code, password: NEW_PASSWORD }),
        401,
        accessProblemCodes.resetCodeInvalid,
      );
    } finally {
      clock.set(systemClock.now());
    }
    expect((await logIn(tenant, PASSWORD)).statusCode).toBe(200);
  });

  it("answers a wrong code, login, or store, and another owner's code, the same way", async () => {
    const tenant = await newTenant("متجر الأخطاء");
    const other = await newTenant("متجر مجاور");
    const { code } = await issue(tenant);
    const { code: othersCode } = await issue(other);
    for (const body of [
      { storeCode: tenant.storeCode, login: "ahmad", code: "AAAAA-AAAAA" },
      { storeCode: tenant.storeCode, login: "nobody", code },
      { storeCode: "ZZZZ22", login: "ahmad", code },
      { storeCode: tenant.storeCode, login: "ahmad", code: othersCode },
      { storeCode: tenant.storeCode, login: "ahmad", code: "not a code" },
    ]) {
      expectProblem(
        await reset({ ...body, password: NEW_PASSWORD }),
        401,
        accessProblemCodes.resetCodeInvalid,
      );
    }
    // Still usable after the wrong tries.
    expect(
      (await reset({ storeCode: tenant.storeCode, login: "ahmad", code, password: NEW_PASSWORD }))
        .statusCode,
    ).toBe(204);
  });
});
