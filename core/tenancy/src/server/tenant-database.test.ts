import { manualClock, seededRandom, uuidV7Generator } from "@mustawfi/kernel";
import { createTestDatabase, type TestDatabase } from "@mustawfi/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTenantDatabase, type TenantDatabase } from "./index.ts";

const newId = uuidV7Generator({
  clock: manualClock(new Date("2026-09-25T00:00:00Z")),
  random: seededRandom(4),
});
const tenantA = newId();
const tenantB = newId();
const branch = newId();
const user = newId();
const device = newId();

const POLICY = "tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid";

let database: TestDatabase;
let tenants: TenantDatabase;

beforeAll(async () => {
  database = await createTestDatabase("core_tenancy");
  const owner = await database.connect("owner");
  try {
    await owner.query(`
      create schema probe;
      create table probe.notes (tenant_id uuid not null, branch_id uuid not null, body text not null);
      alter table probe.notes enable row level security;
      alter table probe.notes force row level security;
      create policy tenant_isolation on probe.notes using (${POLICY}) with check (${POLICY});
      grant usage on schema probe to mustawfi_app;
      grant select, insert on probe.notes to mustawfi_app;`);
  } finally {
    await owner.end();
  }
  tenants = await openTenantDatabase({ connectionString: database.url("app"), maxConnections: 1 });
});

afterAll(async () => {
  await tenants.close();
});

function insertNote(tenantId: string, body: string) {
  return tenants.withTenant({ tenantId }, (tx) =>
    tx.execute(
      sql`insert into probe.notes (tenant_id, branch_id, body) values (${tenantId}, ${branch}, ${body})`,
    ),
  );
}

function notesOf(tenantId: string): Promise<string[]> {
  return tenants.withTenant({ tenantId }, async (tx) => {
    const { rows } = await tx.execute<{ body: string }>(
      sql`select body from probe.notes order by body`,
    );
    return rows.map((r) => r.body);
  });
}

function settings(tenantId: string, extra: { userId?: string; deviceId?: string } = {}) {
  return tenants.withTenant({ tenantId, ...extra }, async (tx) => {
    const { rows } = await tx.execute<{
      pid: number;
      tenant: string;
      user: string;
      device: string;
    }>(sql`select pg_backend_pid() as pid,
      current_setting('app.tenant_id', true) as tenant,
      current_setting('app.user_id', true) as user,
      current_setting('app.device_id', true) as device`);
    return rows[0];
  });
}

describe("withTenant", () => {
  it("sets the tenant, user, and device for the transaction", async () => {
    const seen = await settings(tenantA, { userId: user, deviceId: device });
    expect(seen).toMatchObject({ tenant: tenantA, user, device });
  });

  it("keeps each tenant's rows out of the other's reach", async () => {
    await insertNote(tenantA, "a-1");
    await insertNote(tenantB, "b-1");
    expect(await notesOf(tenantA)).toEqual(["a-1"]);
    expect(await notesOf(tenantB)).toEqual(["b-1"]);
  });

  it("rolls the transaction back when fn throws", async () => {
    await expect(
      tenants.withTenant({ tenantId: tenantA }, async (tx) => {
        await tx.execute(
          sql`insert into probe.notes (tenant_id, branch_id, body) values (${tenantA}, ${branch}, 'lost')`,
        );
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await notesOf(tenantA)).not.toContain("lost");
  });

  it("carries nothing to the next transaction on the same pooled connection", async () => {
    const first = await settings(tenantA, { userId: user, deviceId: device });
    const second = await settings(tenantB);
    expect(second?.pid).toBe(first?.pid);
    expect(second).toMatchObject({ tenant: tenantB, user: "", device: "" });
  });

  it.each([
    ["an empty tenant", { tenantId: "" }],
    ["a malformed tenant", { tenantId: "tenant-a" }],
    ["an uppercase tenant", { tenantId: tenantA.toUpperCase() }],
    ["a malformed user", { tenantId: tenantA, userId: "someone" }],
    ["a malformed device", { tenantId: tenantA, deviceId: "till-1" }],
  ])("refuses %s before touching the database", async (_, context) => {
    let called = false;
    await expect(
      tenants.withTenant(context, () => {
        called = true;
        return Promise.resolve();
      }),
    ).rejects.toThrow(TypeError);
    expect(called).toBe(false);
  });
});

describe("openTenantDatabase", () => {
  it("refuses a superuser connection", async () => {
    await expect(
      openTenantDatabase({ connectionString: database.url("superuser") }),
    ).rejects.toThrow(/bypass row-level security/);
  });

  it("refuses the database owner even before migrations create a schema", async () => {
    const empty = await createTestDatabase("core_tenancy_empty");
    await expect(openTenantDatabase({ connectionString: empty.url("owner") })).rejects.toThrow(
      /owns a schema or the database/,
    );
  });

  it("refuses the schema owner", async () => {
    await expect(openTenantDatabase({ connectionString: database.url("owner") })).rejects.toThrow(
      /owns a schema/,
    );
  });
});
