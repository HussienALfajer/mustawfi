import type { AuditSink, DeviceAuditEvent } from "@mustawfi/core-config/client";
import { manualClock, type Uuid } from "@mustawfi/kernel";
import { type LocalDb, migrateLocalDb } from "@mustawfi/local-db";
import { openNodeLocalDb } from "@mustawfi/local-db/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AccessPart, OverrideRequest } from "../../shared/index.ts";
import { lockedOutUsers, pinLocalMigrations } from "./local-sign-in.ts";
import { bundleCovers, grantOverride, type OverrideDependencies } from "./override.ts";

const SHOP = "0199a000-0000-7000-8000-0000000000d1";
const REPAIRS = "0199a000-0000-7000-8000-0000000000d2";
const OWNER_ROLE = "0199a000-0000-7000-8000-0000000000a1";
const CASHIER_ROLE = "0199a000-0000-7000-8000-0000000000a2";
const SUPERVISOR_ROLE = "0199a000-0000-7000-8000-0000000000a3";
const CASHIER = "0199a000-0000-7000-8000-0000000000b1";
const SUPERVISOR = "0199a000-0000-7000-8000-0000000000b2";
const OWNER = "0199a000-0000-7000-8000-0000000000b3";
const REPAIRS_SUPERVISOR = "0199a000-0000-7000-8000-0000000000b4";
const OVERRIDE_ID = "0199a000-0000-7000-8000-0000000000c1";

/** A verifier the fake check reads back: `pin:<the PIN>`. */
const verifierOf = (pin: string) => `$argon2id$pin:${pin}`;

const part: AccessPart = {
  catalogue: {
    permissions: [
      { id: "sales.invoice.create", moduleId: "sales", scoped: true },
      { id: "audit.view", moduleId: "core.audit", scoped: false },
    ],
    limits: [{ id: "sales.discount.maxPercent", moduleId: "sales", kind: "percent" }],
  },
  roles: [
    {
      id: OWNER_ROLE,
      name: "المالك",
      isOwner: true,
      permissions: ["audit.view", "sales.invoice.create"],
      limits: {},
    },
    { id: CASHIER_ROLE, name: "كاشير القسم", isOwner: false, permissions: [], limits: {} },
    {
      id: SUPERVISOR_ROLE,
      name: "مشرف",
      isOwner: false,
      permissions: ["sales.invoice.create"],
      limits: { "sales.discount.maxPercent": "10" },
    },
  ],
  users: [
    user(CASHIER, "سامر", CASHIER_ROLE, "2580"),
    user(SUPERVISOR, "ليلى", SUPERVISOR_ROLE, "7391"),
    user(OWNER, "هدى", OWNER_ROLE, "4826"),
    {
      ...user(REPAIRS_SUPERVISOR, "باسل", SUPERVISOR_ROLE, "1357"),
      departmentScope: "listed",
      departments: [REPAIRS],
    },
  ],
};

function user(id: string, name: string, roleId: string, pin: string) {
  return {
    id,
    name,
    roleId,
    departmentScope: "all" as "all" | "listed",
    departments: [] as string[],
    pinVerifier: verifierOf(pin),
    pinChangedAt: "2026-09-20T08:00:00.000Z",
  };
}

const sale: OverrideRequest = { permission: "sales.invoice.create", departmentId: SHOP };
const clock = manualClock(new Date("2026-09-26T07:00:00.000Z"));
let db: LocalDb;
let audited: DeviceAuditEvent[];
let dependencies: OverrideDependencies;

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
  dependencies = {
    clock,
    audit: sink,
    newId: () => OVERRIDE_ID as Uuid,
    checkPin: (verifier, pin) => Promise.resolve(verifier === verifierOf(pin)),
  };
});

afterEach(async () => {
  await db.close();
});

const approve = (supervisorId: string, pin: string, request: OverrideRequest = sale) =>
  grantOverride(db, part, { request, requestedBy: CASHIER, supervisorId, pin }, dependencies);

describe("a supervisor's override on the device (flow 15, rule 18)", () => {
  it("grants with the PIN of a supervisor whose role covers the action, audited as theirs", async () => {
    expect(await approve(SUPERVISOR, "7391")).toEqual({
      outcome: "granted",
      override: {
        id: OVERRIDE_ID,
        approverId: SUPERVISOR,
        permission: "sales.invoice.create",
        departmentId: SHOP,
        grantedAt: "2026-09-26T07:00:00.000Z",
      },
    });
    expect(audited).toEqual([
      {
        action: "access.override.granted",
        userId: SUPERVISOR,
        entity: { type: "access.override", id: OVERRIDE_ID },
        after: { requestedBy: CASHIER, permission: "sales.invoice.create", departmentId: SHOP },
      },
    ]);
  });

  it("lets the owner approve anything, up to any value", async () => {
    const discount = { ...sale, limit: { id: "sales.discount.maxPercent", value: "90" } };
    expect(await approve(OWNER, "4826", discount)).toMatchObject({
      outcome: "granted",
      override: { approverId: OWNER, limit: { id: "sales.discount.maxPercent", value: "90" } },
    });
  });

  it("refuses, audited, a supervisor whose role does not cover the department or the value", async () => {
    // Outside the supervisor's departments.
    expect(await approve(REPAIRS_SUPERVISOR, "1357")).toEqual({ outcome: "notCovered" });
    // Beyond the supervisor's limit; up to it is fine.
    const discount = (value: string) => ({
      ...sale,
      limit: { id: "sales.discount.maxPercent", value },
    });
    expect(await approve(SUPERVISOR, "7391", discount("10.5"))).toEqual({
      outcome: "notCovered",
    });
    expect((await approve(SUPERVISOR, "7391", discount("10"))).outcome).toBe("granted");
    // A role without the action at all, approving for someone else.
    expect(
      await grantOverride(
        db,
        part,
        { request: sale, requestedBy: OWNER, supervisorId: CASHIER, pin: "2580" },
        dependencies,
      ),
    ).toEqual({ outcome: "notCovered" });
    expect(audited.map((event) => [event.action, event.userId])).toEqual([
      ["access.override.refused", REPAIRS_SUPERVISOR],
      ["access.override.refused", SUPERVISOR],
      ["access.override.granted", SUPERVISOR],
      ["access.override.refused", CASHIER],
    ]);
    expect(audited[1]).toMatchObject({
      after: {
        requestedBy: CASHIER,
        permission: "sales.invoice.create",
        departmentId: SHOP,
        limit: { id: "sales.discount.maxPercent", value: "10.5" },
      },
    });
  });

  it("counts a supervisor's wrong PIN against the supervisor, and grants nothing", async () => {
    for (const attemptsLeft of [4, 3, 2, 1]) {
      expect(await approve(SUPERVISOR, "0000")).toEqual({ outcome: "wrongPin", attemptsLeft });
    }
    expect(await approve(SUPERVISOR, "0000")).toEqual({ outcome: "lockedOut" });
    expect(await approve(SUPERVISOR, "7391")).toEqual({ outcome: "locked" });
    expect(await lockedOutUsers(db, part)).toEqual(new Set([SUPERVISOR]));
    expect(audited.every((event) => event.action.startsWith("access.pin."))).toBe(true);
  });

  it("never lets the one asking approve their own action", async () => {
    expect(await approve(CASHIER, "2580")).toEqual({ outcome: "notAllowed" });
    expect(audited).toEqual([]);
  });

  it("checks no PIN of a user the bundle does not describe", async () => {
    expect(await approve("0199a000-0000-7000-8000-0000000000ff", "7391")).toEqual({
      outcome: "unavailable",
    });
    expect(audited).toEqual([]);
  });
});

describe("bundleCovers", () => {
  it("reads the role and scope from the bundle as the server does", () => {
    expect(bundleCovers(part, SUPERVISOR, sale)).toBe(true);
    expect(bundleCovers(part, REPAIRS_SUPERVISOR, sale)).toBe(false);
    expect(bundleCovers(part, REPAIRS_SUPERVISOR, { ...sale, departmentId: REPAIRS })).toBe(true);
    expect(bundleCovers(part, CASHIER, sale)).toBe(false);
    expect(bundleCovers(part, OWNER, { permission: "audit.view" })).toBe(true);
    expect(bundleCovers(part, "0199a000-0000-7000-8000-0000000000ff", sale)).toBe(false);
  });
});
