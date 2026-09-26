import { createHash } from "node:crypto";
import {
  acceptBundle,
  type AuditSink,
  type BundleVerifier,
  configLocalMigrations,
  configureApi,
  type DeviceAuditEvent,
  hasSessionCredential,
  holdDeviceCredential,
  holdSession,
} from "@mustawfi/core-config/client";
import { BUNDLE_ALGORITHM, BUNDLE_TYPE, signedBundleSchema } from "@mustawfi/core-config/shared";
import { manualClock } from "@mustawfi/kernel";
import { type LocalDb, migrateLocalDb } from "@mustawfi/local-db";
import { openNodeLocalDb } from "@mustawfi/local-db/node";
import { CompactSign, exportJWK, generateKeyPair } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessPart } from "../../shared/index.ts";
import { accessBundlePart } from "../bundle-part.ts";
import { accessLocalMigrations } from "../device.ts";
import {
  fetchSignedIn,
  lockDevice,
  type PinSignInDependencies,
  restoreDeviceSession,
  signInWithPin,
} from "./device-session.ts";
import {
  lastActivityAt,
  localSession,
  lockedOutUsers,
  openLocalSession,
  pinLocalMigrations,
} from "./local-sign-in.ts";

const TENANT = "0199a000-0000-7000-8000-000000000001";
const OTHER_TENANT = "0199a000-0000-7000-8000-000000000002";
const DEVICE = "0199a000-0000-7000-8000-0000000000d1";
const OWNER_ROLE = "0199a000-0000-7000-8000-0000000000a1";
const CASHIER_ROLE = "0199a000-0000-7000-8000-0000000000a2";
const CASHIER = "0199a000-0000-7000-8000-0000000000b1";
const OWNER = "0199a000-0000-7000-8000-0000000000b3";
const MINUTE = 60_000;

const verifierOf = (pin: string) => `$argon2id$pin:${pin}`;

const ACCESS: AccessPart = {
  catalogue: {
    permissions: [
      { id: "sales.invoice.create", moduleId: "sales", scoped: true },
      { id: "access.users.unlock", moduleId: "core.access", scoped: false },
    ],
    limits: [],
  },
  roles: [
    {
      id: OWNER_ROLE,
      name: "المالك",
      isOwner: true,
      permissions: ["access.users.unlock", "sales.invoice.create"],
      limits: {},
    },
    {
      id: CASHIER_ROLE,
      name: "كاشير القسم",
      isOwner: false,
      permissions: ["sales.invoice.create"],
      limits: {},
    },
  ],
  users: [
    {
      id: CASHIER,
      name: "سامر",
      roleId: CASHIER_ROLE,
      departmentScope: "all",
      departments: [],
      pinVerifier: verifierOf("2580"),
      pinChangedAt: "2026-09-20T08:00:00.000Z",
    },
    {
      id: OWNER,
      name: "هدى",
      roleId: OWNER_ROLE,
      departmentScope: "all",
      departments: [],
      pinVerifier: verifierOf("4826"),
      pinChangedAt: "2026-09-20T08:00:00.000Z",
    },
  ],
};

const clock = manualClock(new Date("2026-09-26T07:00:00.000Z"));
let verifier: BundleVerifier;
let sign: (access: AccessPart, version: number) => Promise<string>;

/** The server's session answer for `userId` (the login and the session routes). */
function sessionAnswer(userId: string, tenantId = TENANT) {
  return {
    expiresAt: "2026-10-03T07:00:00.000Z",
    tenantId,
    user: {
      id: userId,
      name: "من الخادم",
      login: null,
      role: { id: CASHIER_ROLE, name: "كاشير القسم", isOwner: false },
      departmentScope: "all",
      departments: [],
      permissions: ["sales.invoice.create"],
    },
    license: {
      state: "active",
      expiresAt: "2027-09-01T00:00:00.000Z",
      readOnlyAt: "2027-09-08T00:00:00.000Z",
      suspendedAt: "2027-10-08T00:00:00.000Z",
    },
  };
}

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair(BUNDLE_ALGORITHM, {
    crv: "Ed25519",
    extractable: true,
  });
  const { x } = await exportJWK(publicKey);
  if (x === undefined) throw new Error("no public key");
  verifier = { keys: { "test-bundle": x }, decoders: [accessBundlePart] };
  sign = async (access, version) => {
    const text = JSON.stringify(access);
    const manifest = {
      version,
      issuedAt: clock.now().toISOString(),
      deviceId: DEVICE,
      licenseRef: "0199a000-0000-7000-8000-0000000000c1",
      parts: { access: createHash("sha256").update(text, "utf8").digest("base64url") },
    };
    const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(manifest)))
      .setProtectedHeader({ alg: BUNDLE_ALGORITHM, typ: BUNDLE_TYPE, kid: "test-bundle" })
      .sign(privateKey);
    return JSON.stringify({ manifest: jws, parts: { access: text } });
  };
});

let db: LocalDb;
let audited: DeviceAuditEvent[];
let requests: { url: string; init: RequestInit }[];
let answer: (url: string) => Response | Promise<Response>;
let dependencies: PinSignInDependencies;

const sink: AuditSink = {
  record: (_tx, event) => {
    audited.push(event);
    return Promise.resolve();
  },
};

async function storeBundle(access: AccessPart, version: number) {
  const outcome = await acceptBundle(
    db,
    { version, bundle: signedBundleSchema.parse(JSON.parse(await sign(access, version))) },
    verifier,
    { deviceId: DEVICE, tenantId: TENANT },
    clock,
  );
  expect(outcome.outcome).toBe("accepted");
}

const offline = () => Promise.reject(new TypeError("Failed to fetch"));

beforeEach(async () => {
  configureApi({ origin: "", session: "cookie" });
  db = openNodeLocalDb(":memory:");
  await migrateLocalDb(db, [
    ...accessLocalMigrations,
    ...configLocalMigrations,
    ...pinLocalMigrations,
  ]);
  await db.run(
    `INSERT INTO access_device (id, tenant_id, prefix, name, type, credential, base_currency, registered_at)
     VALUES (?, ?, 'K7', 'الصندوق', 'companion', 'd1.credential', 'SYP', ?)`,
    [DEVICE, TENANT, clock.now().toISOString()],
  );
  await storeBundle(ACCESS, 1);
  audited = [];
  requests = [];
  answer = offline;
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    requests.push({ url, init });
    return answer(url);
  });
  dependencies = {
    clock,
    audit: sink,
    checkPin: (stored, pin) => Promise.resolve(stored === verifierOf(pin)),
    verifier,
    online: () => true,
  };
});

afterEach(async () => {
  vi.unstubAllGlobals();
  holdDeviceCredential(undefined);
  await db.close();
});

async function lockOffline(userId: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await signInWithPin(db, { userId, pin: "0000" }, { ...dependencies, online: () => false });
  }
  audited = [];
}

describe("PIN sign-in on a registered device (rules 20–22, 25)", () => {
  it("lets the server check the PIN when it answers, bound to this device, and lifts a lockout here", async () => {
    await lockOffline(CASHIER);
    answer = () => Response.json(sessionAnswer(CASHIER));
    holdDeviceCredential("d1.credential");

    const outcome = await signInWithPin(db, { userId: CASHIER, pin: "2580" }, dependencies);
    expect(outcome).toMatchObject({ outcome: "signedIn", server: { tenantId: TENANT } });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("/api/v1/access/pin-login");
    expect(JSON.parse(requests[0]?.init.body as string)).toEqual({
      userId: CASHIER,
      pin: "2580",
      transport: "cookie",
    });
    // The device credential is the proof beside the PIN, and the browser keeps the cookie the
    // answer sets.
    expect((requests[0]?.init.headers as Record<string, string>)["mustawfi-device"]).toBe(
      "d1.credential",
    );
    expect(requests[0]?.init.credentials).toBe("same-origin");
    expect(await localSession(db)).toMatchObject({
      userId: CASHIER,
      method: "pin",
      serverSession: true,
    });
    expect(await lockedOutUsers(db, ACCESS)).toEqual(new Set());
    // Audited by the server (`access.login.succeeded`), not on the device path.
    expect(audited).toEqual([]);
  });

  it("takes the server's refusal as it is: the device counts nothing", async () => {
    answer = () =>
      Response.json(
        { type: "about:blank", title: "", status: 401, code: "access.login.failed" },
        { status: 401 },
      );
    for (let attempt = 0; attempt < 6; attempt += 1) {
      expect(await signInWithPin(db, { userId: CASHIER, pin: "0000" }, dependencies)).toEqual({
        outcome: "refused",
        code: "access.login.failed",
      });
    }
    expect(await lockedOutUsers(db, ACCESS)).toEqual(new Set());
    expect(await localSession(db)).toBeUndefined();
  });

  it("checks the PIN against the bundle when the server does not answer, and forgets any session held", async () => {
    holdSession(undefined);
    expect(await signInWithPin(db, { userId: CASHIER, pin: "2580" }, dependencies)).toEqual({
      outcome: "signedIn",
      server: null,
    });
    expect(requests).toHaveLength(1);
    expect(hasSessionCredential()).toBe(false);
    expect(await localSession(db)).toMatchObject({ userId: CASHIER, serverSession: false });
    expect(audited.map((event) => event.action)).toEqual(["access.pin.signedIn"]);
  });

  it("asks nothing of the server while the client knows it is offline", async () => {
    const outcome = await signInWithPin(
      db,
      { userId: CASHIER, pin: "0000" },
      {
        ...dependencies,
        online: () => false,
      },
    );
    expect(outcome).toEqual({ outcome: "wrongPin", attemptsLeft: 4 });
    expect(requests).toEqual([]);
  });

  it("checks nothing on the device for a reconnect: out of reach it waits for the server (rule 25)", async () => {
    await db.transaction((tx) =>
      openLocalSession(
        tx,
        { userId: CASHIER, tenantId: TENANT, method: "pin", serverSession: false },
        clock.now(),
      ),
    );
    const openedAt = (await localSession(db))?.openedAt;
    expect(
      await signInWithPin(db, { userId: CASHIER, pin: "2580", serverOnly: true }, dependencies),
    ).toEqual({ outcome: "unreachable" });
    expect(audited).toEqual([]);

    clock.advance(MINUTE);
    answer = () => Response.json(sessionAnswer(CASHIER));
    expect(
      await signInWithPin(db, { userId: CASHIER, pin: "2580", serverOnly: true }, dependencies),
    ).toMatchObject({ outcome: "signedIn" });
    // The same session on the device, now with the server's.
    expect(await localSession(db)).toEqual({
      userId: CASHIER,
      tenantId: TENANT,
      method: "pin",
      openedAt,
      serverSession: true,
    });
  });
});

describe("who is signed in on a registered device", () => {
  const openAs = (userId: string, serverSession: boolean) =>
    db.transaction((tx) =>
      openLocalSession(tx, { userId, tenantId: TENANT, method: "pin", serverSession }, clock.now()),
    );

  it("is the device's user as the bundle describes them while signed in without the server", async () => {
    await openAs(CASHIER, false);
    const signedIn = await fetchSignedIn(db, verifier);
    expect(signedIn).toMatchObject({
      tenantId: TENANT,
      server: null,
      device: { userId: CASHIER },
      user: {
        id: CASHIER,
        name: "سامر",
        role: { id: CASHIER_ROLE, name: "كاشير القسم", isOwner: false },
        departmentScope: "all",
        permissions: ["sales.invoice.create"],
      },
    });
    expect(requests).toEqual([]);
  });

  it("takes the server's view of them only from a session of the same user", async () => {
    await openAs(CASHIER, true);
    answer = () => Response.json(sessionAnswer(CASHIER));
    expect((await fetchSignedIn(db, verifier))?.user.name).toBe("من الخادم");

    // A cookie left from another user never speaks for this one.
    answer = () => Response.json(sessionAnswer(OWNER));
    const signedIn = await fetchSignedIn(db, verifier);
    expect(signedIn?.server).toBeNull();
    expect(signedIn?.user.name).toBe("سامر");
  });

  it("is nobody without the device's session, even with a session of the store (a cookie from before a lock)", async () => {
    answer = () => Response.json(sessionAnswer(OWNER));
    expect(await fetchSignedIn(db, verifier)).toBeNull();
  });

  it("is another store's back office on a device registered elsewhere", async () => {
    answer = () => Response.json(sessionAnswer(OWNER, OTHER_TENANT));
    expect(await fetchSignedIn(db, verifier)).toMatchObject({
      tenantId: OTHER_TENANT,
      device: null,
    });
  });

  it("is nobody once the bundle no longer allows the user on the device", async () => {
    await openAs(CASHIER, false);
    await storeBundle({ ...ACCESS, users: ACCESS.users.filter((u) => u.id !== CASHIER) }, 2);
    expect(await fetchSignedIn(db, verifier)).toBeNull();
  });
});

describe("the device's session at start-up and at a lock (rules 24–25)", () => {
  it("ends a session left idle for the idle time; keeps a recent one and its server session", async () => {
    await db.transaction((tx) =>
      openLocalSession(
        tx,
        { userId: CASHIER, tenantId: TENANT, method: "pin", serverSession: true },
        clock.now(),
      ),
    );
    clock.advance(4 * MINUTE);
    await restoreDeviceSession(db, clock, 5 * MINUTE);
    expect(await localSession(db)).toBeDefined();
    expect(hasSessionCredential()).toBe(true);

    clock.advance(MINUTE);
    await restoreDeviceSession(db, clock, 5 * MINUTE);
    expect(await localSession(db)).toBeUndefined();
    expect(hasSessionCredential()).toBe(false);
    expect(await lastActivityAt(db)).toBeDefined();
  });

  it("sends no cookie of a session the device's user did not open here", async () => {
    await db.transaction((tx) =>
      openLocalSession(
        tx,
        { userId: CASHIER, tenantId: TENANT, method: "pin", serverSession: false },
        clock.now(),
      ),
    );
    await restoreDeviceSession(db, clock, 5 * MINUTE);
    expect(hasSessionCredential()).toBe(false);
  });

  it("ends the session at a lock, telling the server with the session before forgetting it", async () => {
    await db.transaction((tx) =>
      openLocalSession(
        tx,
        { userId: CASHIER, tenantId: TENANT, method: "pin", serverSession: true },
        clock.now(),
      ),
    );
    answer = () => new Response(null, { status: 204 });
    await lockDevice(db);
    expect(await localSession(db)).toBeUndefined();
    expect(hasSessionCredential()).toBe(false);
    expect(requests.map((request) => [request.url, request.init.credentials])).toEqual([
      ["/api/v1/access/logout", "same-origin"],
    ]);
  });
});
