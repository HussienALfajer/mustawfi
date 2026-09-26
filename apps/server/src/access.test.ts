import { createHash } from "node:crypto";
import { registerDevice, SESSION_LIFETIME_MS } from "@mustawfi/core-access/server";
import { accessProblemCodes } from "@mustawfi/core-access/shared";
import { problemDetailsSchema } from "@mustawfi/core-config/shared";
import { openTenantDatabase, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import { cryptoRandom, manualClock, type RandomSource, uuidV7Generator } from "@mustawfi/kernel";
import { createTestDatabase, sqlState, type TestDatabase } from "@mustawfi/testing";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHostServer } from "./host-server.ts";
import { applyMigrations } from "./db/migrate.ts";
import { migrationSets } from "./db/migration-sets.ts";
import { createServerRegistry } from "./modules.ts";
import type { CreatedTenant } from "./tenants/create-tenant.ts";
import { createStaffUser, signInAs } from "./staff.test-helpers.ts";
import { createLicensedTenant } from "./tenants/licensed-tenant.test-helpers.ts";

const PASSWORD = "correct horse battery staple";
const clock = manualClock(new Date("2026-09-25T08:00:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const dependencies = { clock, newId, random: cryptoRandom };

let database: TestDatabase;
let tenants: TenantDatabase;
let server: FastifyInstance;
let superuser: pg.Client;
let store: CreatedTenant;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function newTenant(
  name: string,
  terms: Parameters<typeof createLicensedTenant>[3] = {},
): Promise<CreatedTenant> {
  return createLicensedTenant(
    tenants,
    {
      name,
      baseCurrency: "SYP",
      ownerName: "أحمد",
      ownerLogin: "ahmad",
      ownerPassword: PASSWORD,
    },
    dependencies,
    terms,
  );
}

beforeAll(async () => {
  database = await createTestDatabase("access");
  await applyMigrations(database.url("owner"), migrationSets);
  tenants = await openTenantDatabase({ connectionString: database.url("app") });
  superuser = await database.connect("superuser");
  const registry = createServerRegistry();
  server = await buildHostServer({
    registry,
    services: {
      tenants,
      clock,
      newId,
      random: cryptoRandom,
    },
  });
  store = await newTenant("متجر النور");
});

afterAll(async () => {
  await server.close();
  await superuser.end();
  await tenants.close();
});

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function logIn(body: Record<string, string>) {
  return server.inject({ method: "POST", url: "/api/v1/access/login", payload: body });
}

async function tokenFor(tenant: CreatedTenant = store): Promise<string> {
  const response = await logIn({ storeCode: tenant.storeCode, login: "ahmad", password: PASSWORD });
  expect(response.statusCode).toBe(200);
  return response.json<{ token: string }>().token;
}

function session(token: string) {
  return server.inject({ method: "GET", url: "/api/v1/access/session", headers: bearer(token) });
}

function expectProblem(
  response: { statusCode: number; json(): unknown },
  status: number,
  code: string,
) {
  expect(response.statusCode).toBe(status);
  const body = problemDetailsSchema.parse(response.json());
  expect(body).toMatchObject({ status, code });
  return body;
}

async function auditOf(tenantId: string, action: string) {
  const { rows } = await superuser.query<{
    created_by: string | null;
    device_id: string | null;
    entity_type: string | null;
    entity_id: string | null;
    after: Record<string, unknown> | null;
  }>(
    `select created_by, device_id, entity_type, entity_id, after from core_audit.entries
     where tenant_id = $1 and action = $2 order by created_at, id`,
    [tenantId, action],
  );
  return rows;
}

describe("password login", () => {
  it("returns an opaque session token whose hash alone is stored", async () => {
    const response = await logIn({
      storeCode: store.storeCode,
      login: "ahmad",
      password: PASSWORD,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ token: string; expiresAt: string; tenantId: string }>();
    expect(body).toMatchObject({
      tenantId: store.tenantId,
      expiresAt: new Date(clock.now().getTime() + SESSION_LIFETIME_MS).toISOString(),
      user: {
        id: store.ownerId,
        name: "أحمد",
        login: "ahmad",
        role: { name: "المالك", isOwner: true },
        departmentScope: "all",
        departments: [],
      },
    });
    expect(body.token).toMatch(new RegExp(`^s1\\.${store.tenantId}\\.[A-Za-z0-9_-]{43}$`));

    const { rows } = await superuser.query<{ token_hash: string; row: string }>(
      "select token_hash, to_jsonb(s)::text as row from core_access.sessions s where user_id = $1",
      [store.ownerId],
    );
    const stored = rows.find((row) => row.token_hash === sha256(body.token));
    expect(stored).toBeDefined();
    const secret = body.token.split(".")[2] ?? "";
    for (const row of rows) expect(row.row).not.toContain(secret);

    const current = await session(body.token);
    expect(current.statusCode).toBe(200);
    expect(current.json()).toMatchObject({ tenantId: store.tenantId, user: { id: store.ownerId } });
  });

  it("forgives the case, spaces, and dashes of a store code and the case of a login", async () => {
    const typed = `${store.storeCode.slice(0, 3).toLowerCase()}-${store.storeCode.slice(3)} `;
    const response = await logIn({ storeCode: typed, login: "AHMAD", password: PASSWORD });
    expect(response.statusCode).toBe(200);
  });

  it("answers every failure the same way and audits those within a known store", async () => {
    const failedBefore = (await auditOf(store.tenantId, "access.login.failed")).length;
    const attempts = [
      { storeCode: store.storeCode, login: "ahmad", password: "wrong password" },
      { storeCode: store.storeCode, login: "nobody", password: PASSWORD },
      { storeCode: store.storeCode, login: "not a login!", password: PASSWORD },
      { storeCode: "ZZZZZZ", login: "ahmad", password: PASSWORD },
      { storeCode: "no such code", login: "ahmad", password: PASSWORD },
    ];
    const bodies = [];
    for (const attempt of attempts) {
      const body = expectProblem(await logIn(attempt), 401, accessProblemCodes.loginFailed);
      bodies.push({ ...body, instance: undefined });
    }
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);

    const failed = (await auditOf(store.tenantId, "access.login.failed")).slice(failedBefore);
    expect(failed).toEqual([
      {
        created_by: null,
        device_id: null,
        entity_type: "access.user",
        entity_id: store.ownerId,
        after: null,
      },
      {
        created_by: null,
        device_id: null,
        entity_type: null,
        entity_id: null,
        after: null,
      },
      {
        created_by: null,
        device_id: null,
        entity_type: null,
        entity_id: null,
        after: null,
      },
    ]);
  });

  it("audits a successful login with who and which session", async () => {
    const before = (await auditOf(store.tenantId, "access.login.succeeded")).length;
    await tokenFor();
    const succeeded = (await auditOf(store.tenantId, "access.login.succeeded")).slice(before);
    expect(succeeded).toHaveLength(1);
    expect(succeeded[0]).toMatchObject({
      created_by: store.ownerId,
      entity_type: "access.session",
      after: { login: "ahmad" },
    });
  });

  it("keeps each tenant's logins apart: the same login in two stores", async () => {
    const other = await newTenant("متجر آخر");
    const response = await logIn({
      storeCode: other.storeCode,
      login: "ahmad",
      password: PASSWORD,
    });
    expect(response.json()).toMatchObject({
      tenantId: other.tenantId,
      user: { id: other.ownerId },
    });
  });
});

describe("sessions", () => {
  it("refuses a revoked session on the next request, and audits the revocation", async () => {
    const token = await tokenFor();
    expect((await session(token)).statusCode).toBe(200);
    const logout = await server.inject({
      method: "POST",
      url: "/api/v1/access/logout",
      headers: bearer(token),
    });
    expect(logout.statusCode).toBe(204);
    expectProblem(await session(token), 401, accessProblemCodes.sessionRequired);
    expectProblem(
      await server.inject({ method: "POST", url: "/api/v1/access/logout", headers: bearer(token) }),
      401,
      accessProblemCodes.sessionRequired,
    );
    const { rows } = await superuser.query<{ id: string; revoked_by: string }>(
      "select id, revoked_by from core_access.sessions where token_hash = $1 and revoked_at is not null",
      [sha256(token)],
    );
    expect(rows.map((row) => row.revoked_by)).toEqual([store.ownerId]);
    const revoked = await auditOf(store.tenantId, "access.session.revoked");
    expect(revoked.map((entry) => entry.entity_id)).toContain(rows[0]?.id);
  });

  it("refuses an expired session", async () => {
    const token = await tokenFor();
    clock.advance(SESSION_LIFETIME_MS - 1);
    expect((await session(token)).statusCode).toBe(200);
    clock.advance(1);
    expectProblem(await session(token), 401, accessProblemCodes.sessionRequired);
  });

  it("refuses a missing, malformed, or forged token", async () => {
    const token = await tokenFor();
    const other = await newTenant("متجر ثالث");
    const [tag, , secret] = token.split(".");
    const forged = [
      "",
      "Bearer",
      `${token}x`,
      `${tag}.${other.tenantId}.${secret}`,
      token.replace(/.$/, (last) => (last === "A" ? "B" : "A")),
      `d1.${store.tenantId}.${secret}`,
    ];
    expectProblem(
      await server.inject({ method: "GET", url: "/api/v1/access/session" }),
      401,
      accessProblemCodes.sessionRequired,
    );
    for (const candidate of forged) {
      expectProblem(await session(candidate), 401, accessProblemCodes.sessionRequired);
    }
  });
});

describe("browser sessions (cookie transport, ADR-0022)", () => {
  const HOST = "app.mustawfi.test";
  const sameOrigin = { host: HOST, origin: `https://${HOST}` };

  async function cookieLogIn(headers: Record<string, string> = sameOrigin) {
    return server.inject({
      method: "POST",
      url: "/api/v1/access/login",
      headers,
      payload: {
        storeCode: store.storeCode,
        login: "ahmad",
        password: PASSWORD,
        transport: "cookie",
      },
    });
  }

  async function cookieFor(): Promise<string> {
    const response = await cookieLogIn();
    expect(response.statusCode).toBe(200);
    const setCookie = response.headers["set-cookie"];
    expect(typeof setCookie).toBe("string");
    return String(setCookie).split(";")[0] ?? "";
  }

  it("sets an HttpOnly, Secure, SameSite=Lax cookie for the API and never returns the token", async () => {
    const response = await cookieLogIn();
    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();
    expect(body).not.toHaveProperty("token");
    expect(body).toMatchObject({ tenantId: store.tenantId, user: { login: "ahmad" } });
    const setCookie = String(response.headers["set-cookie"]);
    const [pair, ...attributes] = setCookie.split("; ");
    const token = pair?.replace(/^mustawfi_session=/, "") ?? "";
    expect(token).toMatch(/^s1\./);
    expect(attributes).toEqual(
      expect.arrayContaining(["Path=/api", "HttpOnly", "Secure", "SameSite=Lax"]),
    );
    expect(attributes.find((a) => a.startsWith("Expires="))).toBe(
      `Expires=${new Date(String(body["expiresAt"])).toUTCString()}`,
    );
    const { rowCount } = await superuser.query(
      "select 1 from core_access.sessions where token_hash = $1",
      [sha256(token)],
    );
    expect(rowCount).toBe(1);
  });

  it("authenticates reads with the cookie alone, from any origin", async () => {
    const cookie = await cookieFor();
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/access/session",
      headers: { cookie: `theme=dark; ${cookie}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ user: { login: "ahmad" } });
  });

  it("accepts a change made with the cookie only from the same origin, in every module", async () => {
    const cookie = await cookieFor();
    const create = (headers: Record<string, string>) =>
      server.inject({
        method: "POST",
        url: "/api/v1/inventory/products",
        headers: { cookie, ...headers },
        payload: { name: "كبل", price: { amount: "10", currency: "SYP" } },
      });
    for (const headers of [
      { host: HOST },
      { host: HOST, origin: "https://evil.test" },
      { host: HOST, origin: `http://${HOST}.evil.test` },
      { host: HOST, origin: "null" },
    ]) {
      expectProblem(await create(headers), 403, accessProblemCodes.crossOrigin);
    }
    expect((await create(sameOrigin)).statusCode).toBe(201);
    // A bearer token is not sent by the browser on its own, so it needs no origin check.
    const token = await tokenFor();
    const withBearer = await server.inject({
      method: "POST",
      url: "/api/v1/inventory/products",
      headers: { ...bearer(token), host: HOST, origin: "https://evil.test" },
      payload: { name: "كبل ٢", price: { amount: "10", currency: "SYP" } },
    });
    expect(withBearer.statusCode).toBe(201);
  });

  it("refuses a cookie sign-in from another origin (login CSRF)", async () => {
    expectProblem(
      await cookieLogIn({ host: HOST, origin: "https://evil.test" }),
      403,
      accessProblemCodes.crossOrigin,
    );
    expectProblem(await cookieLogIn({ host: HOST }), 403, accessProblemCodes.crossOrigin);
  });

  it("signs out: revokes the session and clears the cookie", async () => {
    const cookie = await cookieFor();
    const logout = await server.inject({
      method: "POST",
      url: "/api/v1/access/logout",
      headers: { cookie, ...sameOrigin },
    });
    expect(logout.statusCode).toBe(204);
    expect(String(logout.headers["set-cookie"])).toMatch(
      /^mustawfi_session=; Max-Age=0; Path=\/api;/,
    );
    expectProblem(
      await server.inject({ method: "GET", url: "/api/v1/access/session", headers: { cookie } }),
      401,
      accessProblemCodes.sessionRequired,
    );
  });

  it("refuses a malformed or forged cookie like a missing session", async () => {
    for (const cookie of ["mustawfi_session=", "mustawfi_session=s1.x.y", "other=1"]) {
      expectProblem(
        await server.inject({ method: "GET", url: "/api/v1/access/session", headers: { cookie } }),
        401,
        accessProblemCodes.sessionRequired,
      );
    }
  });
});

describe("device registration", () => {
  async function issueCode(token: string) {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/access/registration-codes",
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ code: string; storeCode: string; expiresAt: string }>();
  }

  function register(storeCode: string, registrationCode: string, name = "كاشير ١") {
    return server.inject({
      method: "POST",
      url: "/api/v1/access/devices",
      payload: { storeCode, registrationCode, type: "mainPos", name },
    });
  }

  it("issues codes only to a signed-in owner, stores only their hash, and audits them", async () => {
    expectProblem(
      await server.inject({ method: "POST", url: "/api/v1/access/registration-codes" }),
      401,
      accessProblemCodes.sessionRequired,
    );
    const issued = await issueCode(await tokenFor());
    expect(issued.code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    expect(issued.storeCode).toBe(store.storeCode);
    expect(issued.expiresAt).toBe(new Date(clock.now().getTime() + 15 * 60 * 1000).toISOString());
    const { rows } = await superuser.query<{ id: string }>(
      "select id from core_access.registration_codes where code_hash = $1 and tenant_id = $2",
      [sha256(issued.code.replace("-", "")), store.tenantId],
    );
    expect(rows).toHaveLength(1);
    const audited = await auditOf(store.tenantId, "access.registrationCode.issued");
    expect(audited.map((entry) => entry.entity_id)).toContain(rows[0]?.id);
  });

  it("registers a device with a prefix and a credential, audited, that authenticates it", async () => {
    const { code } = await issueCode(await tokenFor());
    const response = await register(store.storeCode, code.toLowerCase());
    expect(response.statusCode).toBe(201);
    const device = response.json<{
      deviceId: string;
      prefix: string;
      credential: string;
      baseCurrency: string;
    }>();
    expect(device.prefix).toMatch(/^[A-HJ-NP-Z2-9]{2}$/);
    expect(device.baseCurrency).toBe("SYP");
    expect(response.json()).toMatchObject({ tenantId: store.tenantId, name: "كاشير ١" });
    expect(device.credential).toMatch(new RegExp(`^d1\\.${store.tenantId}\\.[A-Za-z0-9_-]{43}$`));

    const { rows } = await superuser.query<{ credential_hash: string; row: string }>(
      "select credential_hash, to_jsonb(d)::text as row from core_access.devices d where id = $1",
      [device.deviceId],
    );
    expect(rows[0]?.credential_hash).toBe(sha256(device.credential));
    expect(rows[0]?.row).not.toContain(device.credential.split(".")[2]);

    const current = await server.inject({
      method: "GET",
      url: "/api/v1/access/devices/current",
      headers: bearer(device.credential),
    });
    expect(current.json()).toEqual({
      deviceId: device.deviceId,
      tenantId: store.tenantId,
      prefix: device.prefix,
      type: "mainPos",
      name: "كاشير ١",
    });
    const [tag, tenantId] = device.credential.split(".");
    for (const credential of [`${tag}.${tenantId}.${"A".repeat(43)}`, await tokenFor(), ""]) {
      expectProblem(
        await server.inject({
          method: "GET",
          url: "/api/v1/access/devices/current",
          headers: bearer(credential),
        }),
        401,
        accessProblemCodes.deviceRequired,
      );
    }

    expect(await auditOf(store.tenantId, "access.device.registered")).toContainEqual({
      created_by: store.ownerId,
      device_id: device.deviceId,
      entity_type: "access.device",
      entity_id: device.deviceId,
      after: expect.objectContaining({
        prefix: device.prefix,
        type: "mainPos",
        name: "كاشير ١",
      }) as unknown,
    });
  });

  it("uses a code once: a second registration is refused, and so is a race", async () => {
    const token = await tokenFor();
    const { code } = await issueCode(token);
    expect((await register(store.storeCode, code)).statusCode).toBe(201);
    expectProblem(
      await register(store.storeCode, code),
      401,
      accessProblemCodes.registrationFailed,
    );

    const raced = await issueCode(token);
    const outcomes = await Promise.all(
      Array.from({ length: 4 }, (_, i) => register(store.storeCode, raced.code, `سباق ${i}`)),
    );
    expect(outcomes.map((r) => r.statusCode).sort()).toEqual([201, 401, 401, 401]);
  });

  it("refuses an expired code, a code of another store, and an unknown store", async () => {
    const { code } = await issueCode(await tokenFor());
    const other = await newTenant("متجر رابع");
    expectProblem(
      await register(other.storeCode, code),
      401,
      accessProblemCodes.registrationFailed,
    );
    expectProblem(await register("ZZZZZZ", code), 401, accessProblemCodes.registrationFailed);
    expectProblem(
      await register(store.storeCode, "ABCDE-FGHJK"),
      401,
      accessProblemCodes.registrationFailed,
    );

    clock.advance(15 * 60 * 1000);
    expectProblem(
      await register(store.storeCode, code),
      401,
      accessProblemCodes.registrationFailed,
    );
  });

  it("issues codes only to a role holding access.devices.manage", async () => {
    const other = await newTenant("متجر الموظف");
    const issue = async (permissions: string[]) => {
      const staff = await createStaffUser(
        tenants,
        other,
        { login: `staff-${String(permissions.length)}`, permissions },
        dependencies,
      );
      return server.inject({
        method: "POST",
        url: "/api/v1/access/registration-codes",
        headers: bearer(await signInAs(server, other, staff.login)),
      });
    };
    expectProblem(await issue(["access.users.manage"]), 403, accessProblemCodes.permissionDenied);
    expect((await issue(["access.users.manage", "access.devices.manage"])).statusCode).toBe(201);
  });
});

describe("device prefixes", () => {
  /** Randomness that always picks the first free prefix, and real randomness for secrets. */
  const firstFree: RandomSource = {
    bytes: (length) => (length === 2 ? new Uint8Array(2) : cryptoRandom.bytes(length)),
  };

  async function registerDirect(tenant: CreatedTenant, random: RandomSource = cryptoRandom) {
    const token = await tokenFor(tenant);
    const code = (
      await server.inject({
        method: "POST",
        url: "/api/v1/access/registration-codes",
        headers: bearer(token),
      })
    ).json<{ code: string }>();
    return tenants.withTenant({ tenantId: tenant.tenantId }, (tx) =>
      registerDevice(
        tx,
        { tenantId: tenant.tenantId, registrationCode: code.code, type: "companion", name: "هاتف" },
        { ...dependencies, random },
      ),
    );
  }

  // More companion devices than any plan allows: the prefixes are under test, not the limit.
  const manyDevices = { limits: { companionDevices: 100 } };

  it("never hands out a prefix the tenant has used, and stays unique per tenant", async () => {
    const tenant = await newTenant("متجر البادئات", manyDevices);
    const prefixes = [];
    for (let i = 0; i < 3; i += 1) prefixes.push((await registerDirect(tenant, firstFree)).prefix);
    expect(prefixes).toEqual(["AA", "AB", "AC"]);

    const random = [];
    for (let i = 0; i < 20; i += 1) random.push((await registerDirect(tenant)).prefix);
    expect(new Set([...prefixes, ...random]).size).toBe(23);

    // Concurrent registrations take turns, so they cannot pick the same free prefix.
    const racing = await newTenant("متجر السباق", manyDevices);
    const raced = await Promise.all(
      Array.from({ length: 4 }, () => registerDirect(racing, firstFree)),
    );
    expect(raced.map((device) => device.prefix).sort()).toEqual(["AA", "AB", "AC", "AD"]);

    // Another tenant has its own prefixes: "AA" again.
    expect((await registerDirect(await newTenant("متجر مستقل"), firstFree)).prefix).toBe("AA");
  });

  it("gives the last free prefix, then refuses when all 1024 are taken", async () => {
    const tenant = await newTenant("متجر ممتلئ");
    await superuser.query(
      `with symbols as (
         select substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', i, 1) as s from generate_series(1, 32) i),
       prefixes as (
         select a.s || b.s as prefix from symbols a cross join symbols b where a.s || b.s <> 'Q7'),
       codes as (
         insert into core_access.registration_codes
           (id, tenant_id, branch_id, created_at, created_by, code_hash, expires_at, used_at)
         select gen_random_uuid(), $1, $2, now(), $3, encode(sha256(prefix::bytea), 'hex'), now(), now()
         from prefixes returning id, code_hash)
       insert into core_access.devices
         (id, tenant_id, branch_id, created_at, created_by, name, type, prefix, credential_hash, registration_code_id)
       select gen_random_uuid(), $1, $2, now(), $3, 'filler', 'mainPos', p.prefix,
         encode(sha256(('credential ' || p.prefix)::bytea), 'hex'), c.id
       from prefixes p join codes c on c.code_hash = encode(sha256(p.prefix::bytea), 'hex')`,
      [tenant.tenantId, tenant.branchId, tenant.ownerId],
    );
    expect((await registerDirect(tenant)).prefix).toBe("Q7");
    await expect(registerDirect(tenant)).rejects.toMatchObject({
      code: accessProblemCodes.prefixesExhausted,
      status: 409,
    });
  });

  it("cannot free or change a prefix: devices are never deleted or edited, and prefixes are unique", async () => {
    const tenant = await newTenant("متجر القيود");
    const device = await registerDirect(tenant);
    const app = await database.connect("app");
    try {
      const asApp = async (statement: string) => {
        await app.query("begin");
        await app.query("select set_config('app.tenant_id', $1, true)", [tenant.tenantId]);
        const outcome = await app.query(statement, [device.deviceId]).then(
          (result) => `changed ${result.rowCount}`,
          (error: unknown) => sqlState(error),
        );
        await app.query("rollback");
        return outcome;
      };
      expect(await asApp("delete from core_access.devices where id = $1")).toBe("42501");
      expect(await asApp("update core_access.devices set prefix = 'ZZ' where id = $1")).toBe(
        "42501",
      );
    } finally {
      await app.end();
    }
    const duplicate = await superuser
      .query(
        `insert into core_access.devices
           (id, tenant_id, branch_id, created_at, created_by, name, type, prefix, credential_hash, registration_code_id)
         select gen_random_uuid(), tenant_id, branch_id, now(), created_by, 'twin', type, prefix,
           repeat('0', 64), registration_code_id from core_access.devices where id = $1`,
        [device.deviceId],
      )
      .then(
        () => "inserted",
        (error: { code?: string; constraint?: string }) => `${error.code} ${error.constraint}`,
      );
    expect(duplicate).toMatch(/^23505 devices_(prefix_per_tenant|registrationCodeId_unique)$/);
    const samePrefixOtherCode = await superuser
      .query(
        `with code as (
           insert into core_access.registration_codes
             (id, tenant_id, branch_id, created_at, created_by, code_hash, expires_at, used_at)
           select gen_random_uuid(), tenant_id, branch_id, now(), created_by, repeat('1', 64), now(), now()
           from core_access.devices where id = $1 returning id)
         insert into core_access.devices
           (id, tenant_id, branch_id, created_at, created_by, name, type, prefix, credential_hash, registration_code_id)
         select gen_random_uuid(), d.tenant_id, d.branch_id, now(), d.created_by, 'twin', d.type, d.prefix,
           repeat('0', 64), code.id from core_access.devices d, code where d.id = $1`,
        [device.deviceId],
      )
      .then(
        () => "inserted",
        (error: { code?: string; constraint?: string }) => `${error.code} ${error.constraint}`,
      );
    expect(samePrefixOtherCode).toBe("23505 devices_prefix_per_tenant");
  });
});

describe("audit log", () => {
  it("records tenant and owner creation, with no secret", async () => {
    const tenant = await newTenant("متجر التدقيق");
    expect(await auditOf(tenant.tenantId, "tenancy.tenant.created")).toEqual([
      {
        created_by: tenant.ownerId,
        device_id: null,
        entity_type: "tenancy.tenant",
        entity_id: tenant.tenantId,
        after: {
          name: "متجر التدقيق",
          baseCurrency: "SYP",
          storeCode: tenant.storeCode,
          defaultBranchId: tenant.branchId,
          defaultDepartmentId: tenant.defaultDepartmentId,
        },
      },
    ]);
    expect(await auditOf(tenant.tenantId, "access.user.created")).toEqual([
      {
        created_by: tenant.ownerId,
        device_id: null,
        entity_type: "access.user",
        entity_id: tenant.ownerId,
        after: {
          name: "أحمد",
          login: "ahmad",
          roleId: expect.any(String) as string,
          departmentScope: "all",
        },
      },
    ]);
    const roles = await auditOf(tenant.tenantId, "access.role.created");
    expect(roles.map((entry) => entry.after?.["template"])).toEqual([
      "owner",
      "accountant",
      "sectionCashier",
      "repairTechnician",
      "topUpOperator",
    ]);
    for (const entry of roles) expect(entry.created_by).toBe(tenant.ownerId);
    const { rows } = await superuser.query<{ text: string }>(
      "select string_agg(to_jsonb(e)::text, ' ') as text from core_audit.entries e",
    );
    expect(rows[0]?.text).not.toContain("$argon2id$");
    expect(rows[0]?.text).not.toContain(PASSWORD);
  });

  it("is append-only: the app role cannot change or delete, and a trigger stops everyone else", async () => {
    const app = await database.connect("app");
    try {
      for (const statement of [
        "update core_audit.entries set action = 'access.login.succeeded'",
        "delete from core_audit.entries",
        "truncate core_audit.entries",
      ]) {
        await app.query("begin");
        await app.query("select set_config('app.tenant_id', $1, true)", [store.tenantId]);
        const outcome = await app.query(statement).then(
          () => "done",
          (error: unknown) => sqlState(error),
        );
        await app.query("rollback");
        expect(outcome, statement).toBe("42501");
      }
    } finally {
      await app.end();
    }
    for (const statement of [
      "update core_audit.entries set action = 'access.login.succeeded'",
      "delete from core_audit.entries",
      "truncate core_audit.entries",
    ]) {
      const outcome = await superuser.query(statement).then(
        () => "done",
        (error: { code?: string; message?: string }) => `${error.code} ${error.message}`,
      );
      expect(outcome, statement).toMatch(/^42501 the audit log is append-only/);
    }
  });
});
