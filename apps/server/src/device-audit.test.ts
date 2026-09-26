import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordAudit } from "@mustawfi/core-audit/server";
import {
  DEVICE_AUDIT_OPERATION,
  syncProblemCodes,
  type PushResponse,
  type SyncOperation,
} from "@mustawfi/core-sync/shared";
import { openTenantDatabase, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { SKELETON_DOCUMENT_DEFAULTS } from "@mustawfi/sales/shared";
import { createTestDatabase, sqlState, type TestDatabase } from "@mustawfi/testing";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testBundleKey } from "./bundle-key.test-helpers.ts";
import { applyMigrations, type MigrationSet } from "./db/migrate.ts";
import { migrationSets } from "./db/migration-sets.ts";
import { buildHostServer } from "./host-server.ts";
import { createServerRegistry } from "./modules.ts";
import type { CreatedTenant } from "./tenants/create-tenant.ts";
import { createLicensedTenant } from "./tenants/licensed-tenant.test-helpers.ts";
import { testTotpKeys } from "./totp-keys.test-helpers.ts";

/**
 * The device audit path (`core-foundation` rule 33, slice 14): an event a device queued in its
 * outbox as `audit.entry.record` is recorded once, with the device's time as `created_at`, the
 * receipt as `recorded_at`, and `source = device`.
 */

const PASSWORD = "correct horse battery staple";
const RECEIVED_AT = new Date("2026-09-25T10:00:00.000Z");
/** The device's clock when the event happened: it went up later, and runs off the server's. */
const HAPPENED_AT = new Date("2026-09-25T08:47:12.345Z");
const clock = manualClock(RECEIVED_AT);
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const dependencies = { clock, newId, random: cryptoRandom };

let database: TestDatabase;
let tenants: TenantDatabase;
let server: FastifyInstance;
let superuser: pg.Client;

beforeAll(async () => {
  database = await createTestDatabase("device_audit");
  await applyMigrations(database.url("owner"), migrationSets);
  tenants = await openTenantDatabase({ connectionString: database.url("app") });
  superuser = await database.connect("superuser");
  server = await buildHostServer({
    registry: createServerRegistry(),
    services: { ...dependencies, tenants, totpKeys: testTotpKeys, bundleKey: testBundleKey },
  });
});

afterAll(async () => {
  await server.close();
  await superuser.end();
  await tenants.close();
});

interface TestDevice {
  readonly deviceId: string;
  readonly credential: string;
  readonly tenant: CreatedTenant;
  seq: number;
}

async function newDevice(): Promise<TestDevice> {
  const tenant = await createLicensedTenant(
    tenants,
    {
      name: "متجر الساعة",
      baseCurrency: "SYP",
      ownerName: "أحمد",
      ownerLogin: "ahmad",
      ownerPassword: PASSWORD,
    },
    dependencies,
  );
  const login = await server.inject({
    method: "POST",
    url: "/api/v1/access/login",
    payload: { storeCode: tenant.storeCode, login: "ahmad", password: PASSWORD },
  });
  const token = login.json<{ token: string }>().token;
  const issued = await server.inject({
    method: "POST",
    url: "/api/v1/access/registration-codes",
    headers: { authorization: `Bearer ${token}` },
  });
  const registered = await server.inject({
    method: "POST",
    url: "/api/v1/access/devices",
    payload: {
      storeCode: tenant.storeCode,
      registrationCode: issued.json<{ code: string }>().code,
      type: "mainPos",
      name: "الصندوق الرئيسي",
    },
  });
  expect(registered.statusCode, registered.body).toBe(201);
  return { ...registered.json<{ deviceId: string; credential: string }>(), tenant, seq: 1 };
}

/** The device's next `audit.entry.record`, as its outbox sink queues it. */
function auditOperation(device: TestDevice, payload: Record<string, unknown>): SyncOperation {
  const deviceSeq = device.seq;
  device.seq += 1;
  return {
    opId: newId(),
    deviceId: device.deviceId,
    deviceSeq,
    type: DEVICE_AUDIT_OPERATION,
    payloadVersion: 1,
    payload,
    userId: device.tenant.ownerId,
    shiftId: SKELETON_DOCUMENT_DEFAULTS.shiftId,
    createdAt: HAPPENED_AT.toISOString(),
  };
}

async function push(device: TestDevice, operations: readonly SyncOperation[]) {
  const response = await server.inject({
    method: "POST",
    url: "/api/v1/sync/push",
    headers: { authorization: `Bearer ${device.credential}` },
    payload: { operations },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<PushResponse>();
}

async function entriesOf(device: TestDevice) {
  const { rows } = await superuser.query<Record<string, unknown>>(
    `select id, tenant_id, branch_id, created_at, recorded_at, source, created_by, device_id,
            action, entity_type, entity_id, before, after, reason
       from core_audit.entries where device_id = $1 and source = 'device' order by recorded_at`,
    [device.deviceId],
  );
  return rows;
}

describe("audit.entry.record", () => {
  it("records a device event once, with the device's time, the receipt time, and its device", async () => {
    const device = await newDevice();
    const operation = auditOperation(device, {
      action: "tenancy.clock.movedBack",
      after: { localTime: "2026-09-25T07:40:00.000Z", highWaterMark: "2026-09-25T08:46:00.000Z" },
    });

    const [first] = (await push(device, [operation])).results;
    if (first?.status !== "accepted") throw new Error(`not accepted: ${JSON.stringify(first)}`);
    // The answer was lost: the device sends it again, twice in one push.
    const again = await push(device, [operation, operation]);
    expect(again.results.map((result) => result.status)).toEqual(["duplicate", "duplicate"]);

    const entries = await entriesOf(device);
    expect(entries).toEqual([
      {
        id: first.result["entryId"],
        tenant_id: device.tenant.tenantId,
        branch_id: device.tenant.branchId,
        created_at: HAPPENED_AT,
        recorded_at: RECEIVED_AT,
        source: "device",
        created_by: device.tenant.ownerId,
        device_id: device.deviceId,
        action: "tenancy.clock.movedBack",
        entity_type: null,
        entity_id: null,
        before: null,
        after: { localTime: "2026-09-25T07:40:00.000Z", highWaterMark: "2026-09-25T08:46:00.000Z" },
        reason: null,
      },
    ]);
  });

  it("keeps the entity, the before values, and the reason a device event carries", async () => {
    const device = await newDevice();
    const entityId = newId();
    const operation = auditOperation(device, {
      action: "tenancy.license.readOnlyReached",
      entity: { type: "tenancy.license", id: entityId },
      before: { state: "grace" },
      after: { state: "readOnly", businessDate: "2026-09-25" },
      reason: "انتهت مهلة السماح",
    });
    expect((await push(device, [operation])).results[0]?.status).toBe("accepted");
    expect(await entriesOf(device)).toEqual([
      expect.objectContaining({
        entity_type: "tenancy.license",
        entity_id: entityId,
        before: { state: "grace" },
        after: { state: "readOnly", businessDate: "2026-09-25" },
        reason: "انتهت مهلة السماح",
      }),
    ]);
  });

  it("rejects an action no module declares as a device event, and a malformed event", async () => {
    const device = await newDevice();
    const forged = auditOperation(device, {
      action: "access.user.created",
      after: { name: "مستخدم مزوّر" },
    });
    const noAction = auditOperation(device, { after: {} });
    const extra = auditOperation(device, { action: "tenancy.clock.movedBack", when: "now" });
    const notEntity = auditOperation(device, {
      action: "tenancy.clock.movedBack",
      entity: { type: "tenancy.license", id: "not-a-uuid" },
    });
    const response = await push(device, [forged, noAction, extra, notEntity]);
    expect(
      response.results.map((result) => [result.status, "code" in result && result.code]),
    ).toEqual([
      ["rejected", syncProblemCodes.auditEntryUnknownAction],
      ["rejected", syncProblemCodes.auditEntryMalformed],
      ["rejected", syncProblemCodes.auditEntryMalformed],
      ["rejected", syncProblemCodes.auditEntryMalformed],
    ]);
    expect(await entriesOf(device)).toEqual([]);
    const { rows } = await superuser.query(
      "select count(*)::int as n from core_audit.entries where tenant_id = $1 and action = 'access.user.created' and device_id = $2",
      [device.tenant.tenantId, device.deviceId],
    );
    expect(rows[0]).toEqual({ n: 0 });
  });

  it("records a server event as it happens, from the server", async () => {
    const device = await newDevice();
    const { rows } = await superuser.query(
      "select source, recorded_at = created_at as at_once from core_audit.entries where tenant_id = $1 and action = 'tenancy.tenant.created'",
      [device.tenant.tenantId],
    );
    expect(rows).toEqual([{ source: "server", at_once: true }]);
  });
});

describe("the audit log's sources", () => {
  it("refuse a device event without its device, and a server event recorded later", async () => {
    const device = await newDevice();
    const { tenantId, branchId, ownerId } = device.tenant;
    const insert = (source: string, deviceId: string | null, recordedAt: Date) =>
      superuser
        .query(
          `insert into core_audit.entries
             (id, tenant_id, branch_id, created_at, recorded_at, source, created_by, device_id, action)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'tenancy.clock.movedBack')`,
          [newId(), tenantId, branchId, HAPPENED_AT, recordedAt, source, ownerId, deviceId],
        )
        .then(
          () => "inserted",
          (error: unknown) => sqlState(error),
        );
    expect(await insert("device", null, RECEIVED_AT)).toBe("23514");
    expect(await insert("server", null, RECEIVED_AT)).toBe("23514");
    expect(await insert("elsewhere", device.deviceId, RECEIVED_AT)).toBe("23514");
    expect(await insert("device", device.deviceId, RECEIVED_AT)).toBe("inserted");
    expect(await insert("server", null, HAPPENED_AT)).toBe("inserted");

    await expect(
      tenants.withTenant({ tenantId, userId: ownerId }, (tx) =>
        recordAudit(tx, {
          id: newId(),
          tenantId,
          branchId,
          occurredAt: HAPPENED_AT,
          receivedAt: RECEIVED_AT,
          userId: ownerId,
          action: "tenancy.clock.movedBack",
        }),
      ),
    ).rejects.toThrow(/names no device/);
  });
});

describe("core.audit migration 0003 on a log that has entries", () => {
  let dir: string | undefined;

  afterAll(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  it("records every earlier entry as a server event recorded when it happened, and keeps the guards", async () => {
    const upgraded = await createTestDatabase("device_audit_upgrade");
    const audit = migrationSets.find((set) => set.moduleId === "core.audit");
    if (audit === undefined) throw new Error("no core.audit migrations");
    // The migrations as the previous release shipped them: core.audit up to 0002.
    dir = mkdtempSync(join(tmpdir(), "mustawfi-audit-"));
    cpSync(audit.dir, dir, { recursive: true });
    const journalPath = join(dir, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: { tag: string }[];
    };
    const upgrade = journal.entries.findIndex((entry) => entry.tag === "0003_audit_device_source");
    expect(upgrade).toBeGreaterThan(0);
    writeFileSync(
      journalPath,
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, upgrade) }),
    );
    const previous: MigrationSet[] = migrationSets.map((set) =>
      set.moduleId === "core.audit" ? { moduleId: set.moduleId, dir: dir ?? "" } : set,
    );
    await applyMigrations(upgraded.url("owner"), previous);

    const owner = await upgraded.connect("superuser");
    try {
      // An entry of the previous release, written past the triggers (a tenant is not needed).
      await owner.query("set session_replication_role = replica");
      await owner.query(
        `insert into core_audit.entries (id, tenant_id, branch_id, created_at, action)
         values ($1, $2, $3, $4, 'tenancy.tenant.created')`,
        [newId(), newId(), newId(), HAPPENED_AT],
      );
      await owner.query("set session_replication_role = origin");

      await applyMigrations(upgraded.url("owner"), migrationSets);

      const { rows } = await owner.query(
        "select source, recorded_at, created_at from core_audit.entries",
      );
      expect(rows).toEqual([
        { source: "server", recorded_at: HAPPENED_AT, created_at: HAPPENED_AT },
      ]);
      const guards = await owner.query(
        `select c.relforcerowsecurity as forced, c.relrowsecurity as enabled,
                (select tgenabled from pg_trigger where tgrelid = c.oid and tgname = 'entries_append_only') as trigger
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'core_audit' and c.relname = 'entries'`,
      );
      expect(guards.rows).toEqual([{ forced: true, enabled: true, trigger: "O" }]);
      const change = await owner
        .query("update core_audit.entries set action = 'tenancy.tenant.renamed'")
        .then(
          () => "changed",
          (error: unknown) => sqlState(error),
        );
      expect(change).toBe("42501");
    } finally {
      await owner.end();
    }
  });
});
