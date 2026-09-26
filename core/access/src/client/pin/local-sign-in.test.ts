import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fc, test as property } from "@fast-check/vitest";
import type { AuditSink, DeviceAuditEvent } from "@mustawfi/core-config/client";
import { manualClock } from "@mustawfi/kernel";
import { type LocalDb, migrateLocalDb } from "@mustawfi/local-db";
import { openNodeLocalDb } from "@mustawfi/local-db/node";
import { hash } from "@node-rs/argon2";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AccessPart } from "../../shared/index.ts";
import { checkPinWithArgon2 } from "./check-pin.ts";
import {
  isIdle,
  lastActivityAt,
  type LocalPinDependencies,
  localSession,
  lockedOutUsers,
  openLocalSession,
  pinLocalMigrations,
  signInLocally,
  unlockUser,
} from "./local-sign-in.ts";

const TENANT = "0199a000-0000-7000-8000-000000000001";
const OWNER_ROLE = "0199a000-0000-7000-8000-0000000000a1";
const CASHIER_ROLE = "0199a000-0000-7000-8000-0000000000a2";
const ACCOUNTANT_ROLE = "0199a000-0000-7000-8000-0000000000a3";
const CASHIER = "0199a000-0000-7000-8000-0000000000b1";
const ACCOUNTANT = "0199a000-0000-7000-8000-0000000000b2";
const OWNER = "0199a000-0000-7000-8000-0000000000b3";
const OTHER_CASHIER = "0199a000-0000-7000-8000-0000000000b4";

/** A verifier the fake check reads back: `pin:<the PIN>`, so each test runs in microseconds. */
const verifierOf = (pin: string) => `$argon2id$pin:${pin}`;

function accessPart(overrides: { readonly cashierPinChangedAt?: string } = {}): AccessPart {
  const user = (id: string, name: string, roleId: string, pin: string) => ({
    id,
    name,
    roleId,
    departmentScope: "all" as const,
    departments: [],
    pinVerifier: verifierOf(pin),
    pinChangedAt: "2026-09-20T08:00:00.000Z",
  });
  return {
    catalogue: { permissions: [], limits: [] },
    roles: [
      { id: OWNER_ROLE, name: "المالك", isOwner: true, permissions: [], limits: {} },
      { id: CASHIER_ROLE, name: "كاشير القسم", isOwner: false, permissions: [], limits: {} },
      {
        id: ACCOUNTANT_ROLE,
        name: "المحاسب",
        isOwner: false,
        permissions: ["access.users.unlock"],
        limits: {},
      },
    ],
    users: [
      {
        ...user(CASHIER, "سامر", CASHIER_ROLE, "2580"),
        pinChangedAt: overrides.cashierPinChangedAt ?? "2026-09-20T08:00:00.000Z",
      },
      user(ACCOUNTANT, "ليلى", ACCOUNTANT_ROLE, "7391"),
      user(OWNER, "هدى", OWNER_ROLE, "4826"),
      user(OTHER_CASHIER, "باسل", CASHIER_ROLE, "1357"),
    ],
  };
}

const clock = manualClock(new Date("2026-09-26T07:00:00.000Z"));
let db: LocalDb;
let audited: DeviceAuditEvent[];
let checks: number;
let dependencies: LocalPinDependencies;

const sink: AuditSink = {
  record: (_tx, event) => {
    audited.push(event);
    return Promise.resolve();
  },
};

beforeEach(async () => {
  db = openNodeLocalDb(":memory:");
  await migrateLocalDb(db, pinLocalMigrations);
  audited = [];
  checks = 0;
  dependencies = {
    clock,
    audit: sink,
    checkPin: (verifier, pin) => {
      checks += 1;
      return Promise.resolve(verifier === verifierOf(pin));
    },
  };
});

afterEach(async () => {
  await db.close();
});

const signIn = (userId: string, pin: string, access = accessPart()) =>
  signInLocally(db, access, { tenantId: TENANT }, { userId, pin }, dependencies);

describe("PIN sign-in on the device without the server (flow 12)", () => {
  it("opens the user's session on the device with a right PIN, with no server session, audited", async () => {
    expect(await signIn(CASHIER, "2580")).toEqual({ outcome: "verified" });
    expect(await localSession(db)).toMatchObject({
      userId: CASHIER,
      tenantId: TENANT,
      method: "pin",
      serverSession: false,
    });
    expect(await lastActivityAt(db)).toBe(clock.now().getTime());
    expect(audited).toEqual([
      {
        action: "access.pin.signedIn",
        userId: CASHIER,
        entity: { type: "access.user", id: CASHIER },
        after: { method: "pin" },
      },
    ]);
  });

  it("locks the user on the device at the fifth wrong PIN, then checks no PIN of theirs (rule 20)", async () => {
    for (const attemptsLeft of [4, 3, 2, 1]) {
      expect(await signIn(CASHIER, "0000")).toEqual({ outcome: "wrongPin", attemptsLeft });
    }
    expect(await signIn(CASHIER, "0000")).toEqual({ outcome: "lockedOut" });
    const checked = checks;
    // Locked: not even the right PIN is checked, and nothing opens.
    expect(await signIn(CASHIER, "2580")).toEqual({ outcome: "locked" });
    expect(checks).toBe(checked);
    expect(await localSession(db)).toBeUndefined();
    expect(await lockedOutUsers(db, accessPart())).toEqual(new Set([CASHIER]));
    // Another user of the device is not affected.
    expect(await signIn(OTHER_CASHIER, "1357")).toEqual({ outcome: "verified" });

    expect(audited.map((event) => event.action)).toEqual([
      ...Array<string>(5).fill("access.pin.failed"),
      "access.pin.lockedOut",
      "access.pin.signedIn",
    ]);
    expect(audited[5]).toMatchObject({
      userId: CASHIER,
      entity: { type: "access.user", id: CASHIER },
      after: { failures: 5, lockedAt: clock.now().toISOString() },
    });
  });

  it("keeps the count across a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mustawfi-pin-"));
    try {
      const path = join(dir, "device.db");
      const first = openNodeLocalDb(path);
      try {
        await migrateLocalDb(first, pinLocalMigrations);
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await signInLocally(
            first,
            accessPart(),
            { tenantId: TENANT },
            { userId: CASHIER, pin: "1" },
            dependencies,
          );
        }
      } finally {
        await first.close();
      }

      const again = openNodeLocalDb(path);
      try {
        await migrateLocalDb(again, pinLocalMigrations);
        expect(
          await signInLocally(
            again,
            accessPart(),
            { tenantId: TENANT },
            { userId: CASHIER, pin: "2580" },
            dependencies,
          ),
        ).toEqual({ outcome: "locked" });
      } finally {
        await again.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("starts the count over once the bundle carries a PIN set again (the lockout reset marker)", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await signIn(CASHIER, "0000");
    expect(await signIn(CASHIER, "2580")).toEqual({ outcome: "locked" });
    const reset = accessPart({ cashierPinChangedAt: "2026-09-26T08:00:00.000Z" });
    expect(await lockedOutUsers(db, reset)).toEqual(new Set());
    expect(await signIn(CASHIER, "0000", reset)).toEqual({ outcome: "wrongPin", attemptsLeft: 4 });
    expect(await signIn(CASHIER, "2580", reset)).toEqual({ outcome: "verified" });
  });

  it("forgets the wrong PINs at a right one: only five in a row lock", async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) await signIn(CASHIER, "0000");
    expect(await signIn(CASHIER, "2580")).toEqual({ outcome: "verified" });
    expect(await signIn(CASHIER, "0000")).toEqual({ outcome: "wrongPin", attemptsLeft: 4 });
  });

  it("cannot sign in a user who is not in the bundle or has no PIN", async () => {
    const access = accessPart();
    const withoutPin = {
      ...access,
      users: access.users.map((user) =>
        user.id === CASHIER ? { ...user, pinVerifier: null } : user,
      ),
    };
    expect(await signIn(CASHIER, "2580", withoutPin)).toEqual({ outcome: "unavailable" });
    expect(await signIn("0199a000-0000-7000-8000-0000000000ff", "2580")).toEqual({
      outcome: "unavailable",
    });
    expect(audited).toEqual([]);
  });

  property.prop([fc.array(fc.boolean(), { maxLength: 14 })])(
    "is locked exactly once five wrong PINs came in a row, and stays locked (rule 20)",
    async (attempts) => {
      const local = openNodeLocalDb(":memory:");
      try {
        await migrateLocalDb(local, pinLocalMigrations);
        let inARow = 0;
        let locked = false;
        for (const right of attempts) {
          const outcome = await signInLocally(
            local,
            accessPart(),
            { tenantId: TENANT },
            { userId: CASHIER, pin: right ? "2580" : "0000" },
            dependencies,
          );
          if (locked) {
            expect(outcome.outcome).toBe("locked");
            continue;
          }
          inARow = right ? 0 : inARow + 1;
          locked = inARow === 5;
          expect(outcome.outcome).toBe(right ? "verified" : locked ? "lockedOut" : "wrongPin");
        }
        expect((await lockedOutUsers(local, accessPart())).has(CASHIER)).toBe(locked);
      } finally {
        await local.close();
      }
    },
  );
});

describe("a supervisor's unlock on the device (flow 13)", () => {
  async function lockCashier() {
    for (let attempt = 0; attempt < 5; attempt += 1) await signIn(CASHIER, "0000");
    audited = [];
  }

  const unlock = (supervisorId: string, pin: string, lockedUserId = CASHIER) =>
    unlockUser(db, accessPart(), { lockedUserId, supervisorId, pin }, dependencies);

  it("unlocks with the PIN of a supervisor whose role holds access.users.unlock, audited as theirs", async () => {
    await lockCashier();
    expect(await unlock(ACCOUNTANT, "7391")).toEqual({ outcome: "unlocked" });
    expect(audited).toEqual([
      {
        action: "access.pin.unlocked",
        userId: ACCOUNTANT,
        entity: { type: "access.user", id: CASHIER },
        before: { failures: 5, lockedAt: clock.now().toISOString() },
      },
    ]);
    // Unlocked: the supervisor signed nobody in, and the cashier signs in.
    expect(await localSession(db)).toBeUndefined();
    expect(await signIn(CASHIER, "2580")).toEqual({ outcome: "verified" });
  });

  it("lets the owner unlock", async () => {
    await lockCashier();
    expect(await unlock(OWNER, "4826")).toEqual({ outcome: "unlocked" });
  });

  it("refuses a supervisor whose role may not unlock, and the locked user themselves", async () => {
    await lockCashier();
    expect(await unlock(OTHER_CASHIER, "1357")).toEqual({ outcome: "notAllowed" });
    expect(await unlock(CASHIER, "2580")).toEqual({ outcome: "notAllowed" });
    expect(await signIn(CASHIER, "2580")).toEqual({ outcome: "locked" });
    expect(audited).toEqual([]);
  });

  it("counts a supervisor's wrong PIN against the supervisor", async () => {
    await lockCashier();
    expect(await unlock(ACCOUNTANT, "0000")).toEqual({ outcome: "wrongPin", attemptsLeft: 4 });
    expect(audited.map((event) => [event.action, event.userId])).toEqual([
      ["access.pin.failed", ACCOUNTANT],
    ]);
    expect(await signIn(CASHIER, "2580")).toEqual({ outcome: "locked" });
  });

  it("says when there is nothing to unlock", async () => {
    expect(await unlock(ACCOUNTANT, "7391")).toEqual({ outcome: "notLocked" });
    expect(audited).toEqual([]);
  });
});

describe("the device's session and the idle time (rule 24)", () => {
  it("is idle once the idle time passed without input, or the clock moved back as far", () => {
    const now = new Date("2026-09-26T07:10:00.000Z");
    const minute = 60_000;
    expect(isIdle(undefined, now, 5 * minute)).toBe(true);
    expect(isIdle(now.getTime() - 4 * minute, now, 5 * minute)).toBe(false);
    expect(isIdle(now.getTime() - 5 * minute, now, 5 * minute)).toBe(true);
    expect(isIdle(now.getTime() + 6 * minute, now, 5 * minute)).toBe(true);
  });

  it("holds one session: a sign-in replaces the previous user's", async () => {
    await db.transaction(async (tx) => {
      await openLocalSession(
        tx,
        { userId: CASHIER, tenantId: TENANT, method: "pin", serverSession: true },
        clock.now(),
      );
      await openLocalSession(
        tx,
        { userId: ACCOUNTANT, tenantId: TENANT, method: "password", serverSession: false },
        clock.now(),
      );
    });
    expect(await localSession(db)).toMatchObject({ userId: ACCOUNTANT, method: "password" });
  });
});

describe("checking a PIN with Argon2id on the device", () => {
  it("reads the server's verifiers, parameters and all", async () => {
    const verifier = await hash("2580", { algorithm: 2 });
    expect(await checkPinWithArgon2(verifier, "2580")).toBe(true);
    expect(await checkPinWithArgon2(verifier, "2581")).toBe(false);
    expect(await checkPinWithArgon2("$argon2id$not-a-verifier", "2580")).toBe(false);
  });
});
