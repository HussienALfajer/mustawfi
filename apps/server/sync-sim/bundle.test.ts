import { accessBundlePart } from "@mustawfi/core-access/client";
import { userAccess } from "@mustawfi/core-access/server";
import {
  type AccessGrant,
  accessGrant,
  type AccessPart,
  bundleUserAccess,
  catalogueFromView,
} from "@mustawfi/core-access/shared";
import {
  acceptBundle,
  type BundleRefusal,
  BundleRefusedError,
  type BundleVerifier,
  configLocalMigrations,
  loadBundle,
  verifyBundle,
  verifyServerTime,
} from "@mustawfi/core-config/client";
import { signBundle } from "@mustawfi/core-config/server";
import {
  type BundleResponse,
  problemDetailsSchema,
  type SignedBundle,
} from "@mustawfi/core-config/shared";
import { organizationBundlePart } from "@mustawfi/core-organization/client";
import type { OrganizationPart } from "@mustawfi/core-organization/shared";
import { licenseBundlePart } from "@mustawfi/core-tenancy/client";
import { openTenantDatabase, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import type { VerifiedLicense } from "@mustawfi/core-tenancy/shared";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { migrateLocalDb } from "@mustawfi/local-db";
import { openNodeLocalDb } from "@mustawfi/local-db/node";
import { createTestDatabase, sqlState, type TestDatabase } from "@mustawfi/testing";
import { generateLicenseKeyPair, issueLicense, licenseClaimsFor } from "@mustawfi/tools-license";
import { issueTestLicense, testLicenseKeys } from "@mustawfi/tools-license/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testBundleKey } from "../src/bundle-key.test-helpers.ts";
import { applyMigrations } from "../src/db/migrate.ts";
import { migrationSets } from "../src/db/migration-sets.ts";
import { buildHostServer } from "../src/host-server.ts";
import { createServerRegistry, serverPermissions } from "../src/modules.ts";
import { installTenantLicense } from "../src/tenants/install-license.ts";
import type { CreatedTenant } from "../src/tenants/create-tenant.ts";
import { createLicensedTenant } from "../src/tenants/licensed-tenant.test-helpers.ts";
import { testTotpKeys } from "../src/totp-keys.test-helpers.ts";

/**
 * `core-foundation` slice 11: the signed configuration bundle (rules 11–12) — built from the
 * modules' parts for one device, versioned by its content, served to devices only, and verified
 * on the device with the client's own code.
 */

const PASSWORD = "correct horse battery staple";
const clock = manualClock(new Date("2026-09-26T10:00:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const dependencies = { clock, newId, random: cryptoRandom };

let database: TestDatabase;
let tenants: TenantDatabase;
let server: FastifyInstance;
let verifier: BundleVerifier;

interface Store {
  readonly tenant: CreatedTenant;
  readonly token: string;
}

interface TestDevice {
  readonly deviceId: string;
  readonly credential: string;
  readonly tenantId: string;
}

beforeAll(async () => {
  database = await createTestDatabase("bundle");
  await applyMigrations(database.url("owner"), migrationSets);
  tenants = await openTenantDatabase({ connectionString: database.url("app") });
  server = await buildHostServer({
    registry: createServerRegistry(),
    services: { ...dependencies, tenants, totpKeys: testTotpKeys, bundleKey: testBundleKey },
  });
  const [kid, x] = testBundleKey.publicKey.split(":") as [string, string];
  verifier = {
    keys: { [kid]: x },
    decoders: [
      licenseBundlePart(await testLicenseKeys()),
      accessBundlePart,
      organizationBundlePart,
    ],
  };
});

afterAll(async () => {
  await server.close();
  await tenants.close();
});

async function newStore(name: string): Promise<Store> {
  const tenant = await createLicensedTenant(
    tenants,
    { name, baseCurrency: "SYP", ownerName: "أحمد", ownerLogin: "ahmad", ownerPassword: PASSWORD },
    dependencies,
  );
  const login = await server.inject({
    method: "POST",
    url: "/api/v1/access/login",
    payload: { storeCode: tenant.storeCode, login: "ahmad", password: PASSWORD },
  });
  expect(login.statusCode).toBe(200);
  return { tenant, token: login.json<{ token: string }>().token };
}

async function newDevice(store: Store): Promise<TestDevice> {
  const issued = await server.inject({
    method: "POST",
    url: "/api/v1/access/registration-codes",
    headers: { authorization: `Bearer ${store.token}` },
  });
  const registered = await server.inject({
    method: "POST",
    url: "/api/v1/access/devices",
    payload: {
      storeCode: store.tenant.storeCode,
      registrationCode: issued.json<{ code: string }>().code,
      type: "companion",
      name: "الجهاز اللوحي",
    },
  });
  expect(registered.statusCode).toBe(201);
  const { deviceId, credential } = registered.json<{ deviceId: string; credential: string }>();
  return { deviceId, credential, tenantId: store.tenant.tenantId };
}

async function fetchBundle(bearer: string, version = 0) {
  return server.inject({
    method: "GET",
    url: `/api/v1/sync/bundle?version=${String(version)}`,
    headers: { authorization: `Bearer ${bearer}` },
  });
}

async function bundleOf(device: TestDevice, version = 0): Promise<BundleResponse> {
  const response = await fetchBundle(device.credential, version);
  expect(response.statusCode).toBe(200);
  return response.json<BundleResponse>();
}

function signedOf(response: BundleResponse): SignedBundle {
  if (response.bundle === null) throw new Error("no bundle in the answer");
  return response.bundle;
}

const identity = (device: TestDevice) => ({
  deviceId: device.deviceId,
  tenantId: device.tenantId,
});

async function refusal(
  bundle: SignedBundle,
  device: TestDevice,
  using: BundleVerifier = verifier,
): Promise<BundleRefusal> {
  const error: unknown = await verifyBundle(bundle, using, identity(device)).catch(
    (e: unknown) => e,
  );
  if (!(error instanceof BundleRefusedError)) throw new Error("the bundle was not refused");
  return error.reason;
}

describe("the configuration bundle (core-foundation slice 11)", () => {
  it("gives a device its bundle, which the device verifies part by part", async () => {
    const store = await newStore("متجر الحزمة");
    const device = await newDevice(store);
    const response = await bundleOf(device);
    expect(response.version).toBe(1);

    const verified = await verifyBundle(signedOf(response), verifier, identity(device));
    const license = verified.parts["license"] as VerifiedLicense;
    expect(license.claims.tenant).toBe(store.tenant.tenantId);

    const access = verified.parts["access"] as AccessPart;
    const [owner] = access.users;
    expect(access.users).toHaveLength(1);
    expect(owner).toMatchObject({ id: store.tenant.ownerId, name: "أحمد", pinVerifier: null });
    expect(access.roles.find((role) => role.id === owner?.roleId)).toMatchObject({
      isOwner: true,
    });
    expect(access.catalogue.permissions.map((p) => p.id)).toContain("sales.invoice.create");

    const organization = verified.parts["organization"] as OrganizationPart;
    expect(organization.profile.name).toBe("متجر الحزمة");
    expect(organization.departments).toEqual([
      expect.objectContaining({ id: store.tenant.defaultDepartmentId, isDefault: true }),
    ]);
  });

  it("carries the server's time with every answer, signed for the device that asked", async () => {
    const store = await newStore("متجر الوقت");
    const device = await newDevice(store);
    const first = await bundleOf(device);
    const held = await bundleOf(device, first.version);
    for (const response of [first, held]) {
      expect(await verifyServerTime(response.time, verifier.keys, device.deviceId)).toEqual(
        clock.now(),
      );
      expect(await verifyServerTime(response.time, verifier.keys, newId())).toBeUndefined();
    }
  });

  it("answers the version alone to a device that holds it, and bumps it only on a change", async () => {
    const store = await newStore("متجر الإصدارات");
    const device = await newDevice(store);
    const first = await bundleOf(device);
    expect(await bundleOf(device, first.version)).toMatchObject({ version: 1, bundle: null });
    // Rebuilt from the same data: the same version, and the same signed manifest — also when
    // several requests of one device meet.
    const again = await Promise.all([1, 2, 3, 4].map(() => bundleOf(device)));
    expect(new Set(again.map((response) => signedOf(response).manifest))).toEqual(
      new Set([signedOf(first).manifest]),
    );

    const changes: [string, () => Promise<void>][] = [
      [
        "access",
        async () => {
          const created = await server.inject({
            method: "POST",
            url: "/api/v1/access/users",
            headers: { authorization: `Bearer ${store.token}` },
            payload: {
              name: "سلمى",
              roleId: (await roleIdOf(store, "كاشير القسم")) ?? "",
              departmentScope: "all",
              departments: [],
              pin: "2580",
            },
          });
          expect(created.statusCode).toBe(201);
        },
      ],
      [
        "organization",
        async () => {
          const added = await server.inject({
            method: "POST",
            url: "/api/v1/organization/departments",
            headers: { authorization: `Bearer ${store.token}` },
            payload: { name: "الصيانة" },
          });
          expect(added.statusCode).toBe(201);
        },
      ],
      [
        "license",
        async () => {
          clock.advance(60_000);
          const { jws } = await issueTestLicense({
            tenant: store.tenant.tenantId,
            issuedAt: clock.now(),
            limits: { users: 9 },
          });
          await installTenantLicense(
            tenants,
            { storeCode: store.tenant.storeCode, license: jws },
            { ...dependencies, licenseKeys: await testLicenseKeys() },
          );
        },
      ],
    ];
    let version = first.version;
    let previous = signedOf(first);
    for (const [part, change] of changes) {
      await change();
      const next = await bundleOf(device, version);
      expect(next.version, part).toBe(version + 1);
      const bundle = signedOf(next);
      // Only the changed part's text differs.
      for (const name of ["license", "access", "organization"]) {
        expect(bundle.parts[name] === previous.parts[name], `${part}: ${name}`).toBe(name !== part);
      }
      await verifyBundle(bundle, verifier, identity(device));
      version = next.version;
      previous = bundle;
    }
    const access = JSON.parse(previous.parts["access"] ?? "") as AccessPart;
    expect(access.users.find((user) => user.name === "سلمى")?.pinVerifier).toMatch(/^\$argon2id\$/);
  });

  it("serves devices only: a session, an unknown credential, or a revoked device is refused", async () => {
    const store = await newStore("متجر الرفض");
    const device = await newDevice(store);
    // A session is not a device, not even the owner's (rule 22).
    expect((await fetchBundle(store.token)).statusCode).toBe(401);
    expect((await fetchBundle("d1.not-a-credential")).statusCode).toBe(401);

    const revoked = await server.inject({
      method: "POST",
      url: `/api/v1/access/devices/${device.deviceId}/revoke`,
      headers: { authorization: `Bearer ${store.token}` },
      payload: { reason: "سُرق الجهاز" },
    });
    expect(revoked.statusCode).toBe(200);
    const refused = await fetchBundle(device.credential);
    expect(refused.statusCode).toBe(401);
    expect(problemDetailsSchema.parse(refused.json()).code).toBe("access.device.revoked");
  });

  it("is refused by any other device, of the same store or another", async () => {
    const store = await newStore("متجر الجهازين");
    const [first, second] = [await newDevice(store), await newDevice(store)];
    const bundle = signedOf(await bundleOf(first));
    expect(await refusal(bundle, second)).toBe("otherDevice");
    const elsewhere = await newDevice(await newStore("متجر آخر"));
    expect(await refusal(bundle, elsewhere)).toBe("otherDevice");
  });

  for (const part of ["license", "access", "organization"]) {
    it(`is refused when its ${part} part was changed on the way`, async () => {
      const device = await newDevice(await newStore(`متجر ${part}`));
      const bundle = signedOf(await bundleOf(device));
      const text = bundle.parts[part] ?? "";
      const tampered = { ...bundle, parts: { ...bundle.parts, [part]: text.replace("a", "b") } };
      expect(tampered.parts[part]).not.toBe(text);
      expect(await refusal(tampered, device)).toBe("badHash");
    });
  }

  it("is refused when it carries a license the license keys do not vouch for (ADR-0021)", async () => {
    const store = await newStore("متجر الترخيص");
    const device = await newDevice(store);
    const bundle = signedOf(await bundleOf(device));
    // Someone holding the bundle key signs a bundle with a license of their own making.
    const forger = await generateLicenseKeyPair("test");
    const forged = await issueLicense(
      licenseClaimsFor({ tenant: store.tenant.tenantId, plan: "phonesPro", issuedAt: clock.now() }),
      forger.privateKey,
    );
    const resigned = await signBundle(
      {
        version: 2,
        issuedAt: clock.now(),
        deviceId: device.deviceId,
        licenseRef: newId(),
        parts: { ...bundle.parts, license: JSON.stringify(forged) },
      },
      testBundleKey,
    );
    expect(await refusal(resigned, device)).toBe("badPart");
  });

  it("is refused when its license names another tenant", async () => {
    const store = await newStore("متجر المستأجر");
    const device = await newDevice(store);
    const bundle = signedOf(await bundleOf(device));
    const { jws } = await issueTestLicense({ issuedAt: clock.now() });
    const resigned = await signBundle(
      {
        version: 2,
        issuedAt: clock.now(),
        deviceId: device.deviceId,
        licenseRef: newId(),
        parts: { ...bundle.parts, license: JSON.stringify(jws) },
      },
      testBundleKey,
    );
    expect(await refusal(resigned, device)).toBe("badPart");
  });

  it("keeps a device's version moving forward, whatever the application sends", async () => {
    const store = await newStore("متجر القيود");
    const device = await newDevice(store);
    await bundleOf(device);
    const app = await database.connect("app");
    try {
      await app.query("select set_config('app.tenant_id', $1, false)", [store.tenant.tenantId]);
      const refused = async (statement: string, state: string) => {
        await expect(app.query(statement, [device.deviceId])).rejects.toSatisfy(
          (error: unknown) => sqlState(error) === state,
        );
      };
      // A version never moves back: devices would refuse its bundle as stale (rule 11).
      await refused(
        "update core_sync.bundle_versions set version = version - 1 where device_id = $1",
        "23514",
      );
      // Only the version, its digest, and its issue time change; the row is never deleted.
      await refused(
        "update core_sync.bundle_versions set device_id = gen_random_uuid() where device_id = $1",
        "42501",
      );
      await refused("delete from core_sync.bundle_versions where device_id = $1", "42501");
      await app.query(
        "update core_sync.bundle_versions set version = version + 1 where device_id = $1",
        [device.deviceId],
      );
    } finally {
      await app.end();
    }
  });

  it("keeps the previous bundle on the device when a new one is refused", async () => {
    const store = await newStore("متجر الاحتفاظ");
    const device = await newDevice(store);
    const db = openNodeLocalDb(":memory:");
    try {
      await migrateLocalDb(db, configLocalMigrations);
      const first = await bundleOf(device);
      await acceptBundle(db, first, verifier, identity(device), clock);

      await server.inject({
        method: "POST",
        url: "/api/v1/organization/departments",
        headers: { authorization: `Bearer ${store.token}` },
        payload: { name: "الإكسسوارات" },
      });
      const second = await bundleOf(device, first.version);
      const bundle = signedOf(second);
      const corrupted = {
        ...second,
        bundle: { ...bundle, parts: { ...bundle.parts, organization: "{}" } },
      };
      expect(await acceptBundle(db, corrupted, verifier, identity(device), clock)).toEqual({
        outcome: "refused",
        reason: "badHash",
      });
      const kept = await loadBundle(db, verifier, identity(device));
      expect(kept).toMatchObject({ state: "refused", reason: "badHash", bundle: { version: 1 } });

      expect(await acceptBundle(db, second, verifier, identity(device), clock)).toEqual({
        outcome: "accepted",
        version: 2,
      });
      const loaded = await loadBundle(db, verifier, identity(device));
      expect(loaded.state).toBe("valid");
    } finally {
      await db.close();
    }
  });
});

describe("grants on the device (core-foundation slice 16)", () => {
  /** Every answer a grant gives: each permission in each department and without one, each limit. */
  function answers(grant: AccessGrant, part: AccessPart, departments: readonly string[]) {
    const scoped = new Map(part.catalogue.permissions.map((p) => [p.id, p.scoped]));
    return {
      permissions: grant.permissions,
      can: [...scoped].flatMap(([permission, isScoped]) => [
        ...departments.map((department) => grant.can(permission, department)),
        ...(isScoped ? [] : [grant.can(permission)]),
      ]),
      limits: part.catalogue.limits.map((limit) => grant.limitFor(limit.id)),
    };
  }

  it("resolves each user from the access part exactly as the server resolves them", async () => {
    const store = await newStore("متجر المنح");
    const headers = { authorization: `Bearer ${store.token}` };
    const departments = [store.tenant.defaultDepartmentId];
    for (const name of ["الصيانة", "الإكسسوارات"]) {
      const added = await server.inject({
        method: "POST",
        url: "/api/v1/organization/departments",
        headers,
        payload: { name },
      });
      expect(added.statusCode).toBe(201);
      departments.push(added.json<{ id: string }>().id);
    }
    const [shop, repairs, accessories] = departments as [string, string, string];
    // A copy holding one scoped and one unscoped permission, and the seeded templates.
    const copy = await server.inject({
      method: "POST",
      url: "/api/v1/access/roles",
      headers,
      payload: { name: "مشرف الصيانة", permissions: ["sales.invoice.create", "audit.view"] },
    });
    expect(copy.statusCode, copy.body).toBe(201);
    const users = [
      { role: "كاشير القسم", departmentScope: "listed", departments: [repairs] },
      { role: "كاشير القسم", departmentScope: "listed", departments: [repairs, accessories] },
      { role: "كاشير القسم", departmentScope: "all", departments: [] },
      { role: "المحاسب", departmentScope: "all", departments: [] },
      { role: "مشرف الصيانة", departmentScope: "listed", departments: [shop] },
    ];
    for (const [index, user] of users.entries()) {
      const created = await server.inject({
        method: "POST",
        url: "/api/v1/access/users",
        headers,
        payload: {
          name: `مستخدم ${String(index)}`,
          roleId: await roleIdOf(store, user.role),
          departmentScope: user.departmentScope,
          departments: user.departments,
          pin: "2580",
        },
      });
      expect(created.statusCode, created.body).toBe(201);
    }
    // Archived, the accessories department leaves every scope, on both sides.
    const archived = await server.inject({
      method: "POST",
      url: `/api/v1/organization/departments/${accessories}/archive`,
      headers,
    });
    expect(archived.statusCode).toBe(200);

    const device = await newDevice(store);
    const verified = await verifyBundle(
      signedOf(await bundleOf(device)),
      verifier,
      identity(device),
    );
    const part = verified.parts["access"] as AccessPart;
    expect(part.users).toHaveLength(users.length + 1);
    const catalogue = catalogueFromView(part.catalogue);
    const everywhere = [...departments, newId()];
    for (const user of part.users) {
      const onDevice = bundleUserAccess(part, user.id);
      if (onDevice === undefined) throw new Error(`${user.name} is not in the part`);
      const onServer = await tenants.withTenant(
        { tenantId: store.tenant.tenantId, userId: store.tenant.ownerId },
        (tx) => userAccess(tx, user.id, serverPermissions()),
      );
      if (onServer === undefined) throw new Error(`${user.name} is not on the server`);
      expect(answers(accessGrant(catalogue, onDevice), part, everywhere), user.name).toEqual(
        answers(accessGrant(serverPermissions(), onServer.access), part, everywhere),
      );
    }
    // What the users above make of the resolution, so the comparison is not of nothing.
    const cashier = part.users.find((user) => user.name === "مستخدم 0");
    const grant = accessGrant(catalogue, bundleUserAccess(part, cashier?.id ?? "")!);
    expect(grant.can("sales.invoice.create", repairs)).toBe(true);
    expect(grant.can("sales.invoice.create", shop)).toBe(false);
  });
});

async function roleIdOf(store: Store, name: string): Promise<string | undefined> {
  const roles = await server.inject({
    method: "GET",
    url: "/api/v1/access/roles",
    headers: { authorization: `Bearer ${store.token}` },
  });
  return roles
    .json<{ items: { id: string; name: string }[] }>()
    .items.find((role) => role.name === name)?.id;
}
