/**
 * The sync simulation harness, v1 (ADR-0026, walking-skeleton slice 12): three virtual devices,
 * each running the real client code — local database on the Node SQLite adapter, POS sale,
 * outbox, and sync engine over the real HTTP transport — against the real server and a real
 * PostgreSQL, through a network that drops, duplicates, delays, and reorders requests and cuts
 * devices off, every choice drawn from a seed. After the network heals and the devices sync,
 * no invoice is lost or duplicated, numbers have no gaps and the server saw none, the ledger
 * balances, stock is what was received minus what was sold, and every device holds every
 * product.
 *
 * Replay a failing run with its seed: `SYNC_SIM_SEEDS=1234 pnpm test:agent sync-sim`.
 * Longer runs: `SYNC_SIM_STEPS=2000`.
 */
import {
  accessLocalMigrations,
  type LocalDevice,
  registerThisDevice,
} from "@mustawfi/core-access/client";
import {
  organizationLocalMigrations,
  organizationPullAppliers,
} from "@mustawfi/core-organization/client";
import {
  createApiSyncTransport,
  createSyncEngine,
  outboxCounts,
  type SyncEngine,
  syncLocalMigrations,
} from "@mustawfi/core-sync/client";
import { openTenantDatabase, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import {
  inventoryLocalMigrations,
  inventoryPullAppliers,
  listLocalProducts,
} from "@mustawfi/inventory/client";
import { moveStock } from "@mustawfi/inventory/server";
import type { ProductView } from "@mustawfi/inventory/shared";
import {
  type Clock,
  cryptoRandom,
  Decimal,
  type IdGenerator,
  manualClock,
  uuidV7Generator,
} from "@mustawfi/kernel";
import { type LocalDb, migrateLocalDb } from "@mustawfi/local-db";
import { openNodeLocalDb } from "@mustawfi/local-db/node";
import {
  addToCart,
  completeCashSale,
  listLocalInvoices,
  salesLocalMigrations,
} from "@mustawfi/sales/client";
import { createTestDatabase } from "@mustawfi/testing";
import {
  converge,
  convergenceProblems,
  createSimulatedNetwork,
  type DeviceSnapshot,
  type FaultRates,
  type LinkStats,
  runSimulation,
  type ServerSnapshot,
  type SimAction,
  type SimulatedLink,
  type SimRandom,
  simRandom,
} from "@mustawfi/testing/sync-sim";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/app.ts";
import { applyMigrations } from "../src/db/migrate.ts";
import { migrationSets } from "../src/db/migration-sets.ts";
import { createServerRegistry, hostSyncOperations } from "../src/modules.ts";
import type { CreatedTenant } from "../src/tenants/create-tenant.ts";
import { createLicensedTenant } from "../src/tenants/licensed-tenant.test-helpers.ts";

function envInteger(name: string, fallback: number): number {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : Number.parseInt(value, 10);
}

/** The seeds CI runs; each is a separate store on the same server. */
const SEEDS = (process.env["SYNC_SIM_SEEDS"] ?? "1,2,3")
  .split(",")
  .map((seed) => Number.parseInt(seed.trim(), 10));
const STEPS = envInteger("SYNC_SIM_STEPS", 300);
/** The time budget of one seed's run in CI, from the first step to the checked convergence. */
const BUDGET_MS = envInteger("SYNC_SIM_BUDGET_MS", 30_000);
const DEVICES = 3;
/** Four in ten requests meet a fault. */
const FAULTS: FaultRates = { dropRequest: 0.1, dropResponse: 0.1, duplicate: 0.1, delay: 0.1 };

const PASSWORD = "correct horse battery staple";
const START = new Date("2026-09-25T06:00:00.000Z");
const realFetch = globalThis.fetch;

let tenants: TenantDatabase;
let server: FastifyInstance;
let baseUrl: string;
const serverClock = manualClock(START);
const serverDependencies = {
  clock: serverClock,
  newId: uuidV7Generator({ clock: serverClock, random: cryptoRandom }),
  random: cryptoRandom,
};

beforeAll(async () => {
  const database = await createTestDatabase("sync_sim");
  await applyMigrations(database.url("owner"), migrationSets);
  tenants = await openTenantDatabase({ connectionString: database.url("app") });
  const registry = createServerRegistry();
  server = await buildServer({
    registry,
    context: { ...serverDependencies, tenants, syncOperations: hostSyncOperations(registry) },
  });
  baseUrl = await server.listen({ host: "127.0.0.1", port: 0 });
  // The client code calls the API by path, as it does from the web app's origin; device
  // registration uses the platform fetch, so it goes to this server without faults.
  vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    realFetch(new URL(input instanceof Request ? input.url : input, baseUrl), init),
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await server.close();
  await tenants.close();
});

/** The owner's calls to the API: online master data, outside the simulated network. */
async function ownerRequest<T>(
  path: string,
  token: string | undefined,
  body?: unknown,
): Promise<T> {
  const response = await realFetch(new URL(path, baseUrl), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(`${path} answered ${String(response.status)}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

interface SimDevice {
  readonly name: string;
  readonly db: LocalDb;
  readonly local: LocalDevice;
  readonly engine: SyncEngine;
  readonly link: SimulatedLink;
  readonly clock: Clock;
  readonly newId: IdGenerator;
}

interface Store {
  readonly tenant: CreatedTenant;
  readonly token: string;
  /** Stock put on hand per product, outside sales. */
  readonly received: Map<string, Decimal>;
  readonly productIds: string[];
}

async function openStore(seed: number): Promise<Store> {
  const tenant = await createLicensedTenant(
    tenants,
    {
      name: `متجر المحاكاة ${String(seed)}`,
      baseCurrency: "SYP",
      ownerName: "أحمد",
      ownerLogin: "ahmad",
      ownerPassword: PASSWORD,
    },
    serverDependencies,
  );
  const { token } = await ownerRequest<{ token: string }>("/api/v1/access/login", undefined, {
    storeCode: tenant.storeCode,
    login: "ahmad",
    password: PASSWORD,
  });
  return { tenant, token, received: new Map(), productIds: [] };
}

/** A product with a random price from 0.01 to 5000.00 SYP. */
async function newProduct(store: Store, random: SimRandom): Promise<ProductView> {
  const cents = BigInt(random.int(1, 500_000));
  const product = await ownerRequest<ProductView>("/api/v1/inventory/products", store.token, {
    name: `منتج ${String(random.int(1000, 9999))}`,
    price: { amount: Decimal.fromScaledInteger(cents, 2).toString(), currency: "SYP" },
  });
  store.productIds.push(product.id);
  return product;
}

/** A stock receipt, as the receiving module will post it (there is no route yet). */
async function receiveStock(store: Store, productId: string, quantity: Decimal): Promise<void> {
  const { tenantId, branchId, ownerId } = store.tenant;
  await tenants.withTenant({ tenantId, userId: ownerId }, (tx) =>
    moveStock(
      tx,
      {
        tenantId,
        branchId,
        createdAt: serverClock.now(),
        createdBy: ownerId,
        source: { type: "inventory.receipt", id: serverDependencies.newId() },
        movements: [{ productId, quantity }],
      },
      serverDependencies,
    ),
  );
  store.received.set(productId, (store.received.get(productId) ?? Decimal.ZERO).plus(quantity));
}

async function openDevice(
  store: Store,
  name: string,
  random: SimRandom,
  link: SimulatedLink,
  failures: string[],
): Promise<SimDevice> {
  // Each device's clock runs off the server's by a few minutes either way.
  const skew = random.int(-10, 10) * 60_000;
  const clock: Clock = { now: () => new Date(serverClock.now().getTime() + skew) };
  const db = openNodeLocalDb(":memory:");
  await migrateLocalDb(db, [
    ...accessLocalMigrations,
    ...syncLocalMigrations,
    ...inventoryLocalMigrations,
    ...salesLocalMigrations,
    ...organizationLocalMigrations,
  ]);
  const { code } = await ownerRequest<{ code: string }>(
    "/api/v1/access/registration-codes",
    store.token,
    {},
  );
  const local = await registerThisDevice(
    db,
    { type: "mainPos", storeCode: store.tenant.storeCode, registrationCode: code, name },
    clock,
  );
  const engine = createSyncEngine({
    db,
    appliers: [...organizationPullAppliers, ...inventoryPullAppliers],
    clock,
    transport: createApiSyncTransport({ fetch: link.fetch }),
  });
  // A round the server refuses (`failed`) is a bug here: every device is valid.
  engine.subscribe(() => {
    const status = engine.status();
    if (status.phase === "failed") failures.push(`${name}: ${status.failure ?? "?"}`);
  });
  const newId = uuidV7Generator({ clock, random: random.fork("ids").source });
  return { name, db, local, engine, link, clock, newId };
}

async function deviceSnapshot(device: SimDevice): Promise<DeviceSnapshot> {
  const invoices = await listLocalInvoices(device.db, 1_000_000);
  return {
    name: device.name,
    deviceId: device.local.deviceId,
    prefix: device.local.prefix,
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      total: invoice.total.amount.toString(),
      syncState: invoice.syncState,
      rejectionCode: invoice.rejectionCode,
    })),
    productIds: (await listLocalProducts(device.db)).map((product) => product.id),
  };
}

/** The store as the server holds it, read under RLS as the app role. */
function serverSnapshot(store: Store): Promise<ServerSnapshot> {
  const { tenantId, ownerId } = store.tenant;
  return tenants.withTenant({ tenantId, userId: ownerId }, async (tx) => {
    const invoices = await tx.execute<{
      id: string;
      number: string;
      device_id: string;
      total: string;
      lines: { productId: string; quantity: string }[];
    }>(sql`
      SELECT i.id, i.number, i.device_id, i.total::text AS total,
        coalesce(
          json_agg(json_build_object('productId', l.product_id, 'quantity', l.quantity::text))
            FILTER (WHERE l.id IS NOT NULL),
          '[]'::json
        ) AS lines
      FROM sales.invoices i LEFT JOIN sales.invoice_lines l ON l.invoice_id = i.id
      GROUP BY i.id`);
    const entries = await tx.execute<{
      id: string;
      source_id: string;
      debit: string;
      credit: string;
    }>(sql`
      SELECT e.id, e.source_id, sum(l.debit)::text AS debit, sum(l.credit)::text AS credit
      FROM core_ledger.journal_entries e
      JOIN core_ledger.journal_lines l ON l.journal_entry_id = e.id
      GROUP BY e.id`);
    const products = await tx.execute<{ id: string }>(sql`SELECT id FROM inventory.products`);
    const stock = await tx.execute<{ product_id: string; on_hand: string }>(
      sql`SELECT product_id, on_hand::text AS on_hand FROM inventory.stock_levels`,
    );
    const sequences = await tx.execute<{ device_id: string; doc_code: string; last_seq: string }>(
      sql`SELECT device_id, doc_code, last_seq FROM core_organization.document_sequences`,
    );
    const flags = await tx.execute<{ op_id: string; code: string }>(
      sql`SELECT op_id, code FROM core_sync.operation_flags`,
    );
    return {
      invoices: invoices.rows.map((row) => ({
        id: row.id,
        number: row.number,
        deviceId: row.device_id,
        total: row.total,
        lines: row.lines,
      })),
      entries: entries.rows.map((row) => ({
        id: row.id,
        sourceId: row.source_id,
        debit: row.debit,
        credit: row.credit,
      })),
      productIds: products.rows.map((row) => row.id),
      stock: stock.rows.map((row) => ({ productId: row.product_id, onHand: row.on_hand })),
      sequences: sequences.rows.map((row) => ({
        deviceId: row.device_id,
        docCode: row.doc_code,
        lastSeq: Number.parseInt(row.last_seq, 10),
      })),
      operationFlags: flags.rows.map((row) => ({ opId: row.op_id, code: row.code })),
    };
  });
}

interface RunResult {
  readonly trace: readonly string[];
  readonly problems: readonly string[];
  readonly failures: readonly string[];
  readonly network: Readonly<LinkStats>;
  readonly outboxStates: Readonly<Record<string, number>>;
  readonly invoices: number;
  readonly convergeRounds: number;
  readonly elapsedMs: number;
}

async function simulate(seed: number): Promise<RunResult> {
  const devices: SimDevice[] = [];
  try {
    return await run(seed, devices);
  } finally {
    for (const device of devices) await device.db.close();
  }
}

async function run(seed: number, devices: SimDevice[]): Promise<RunResult> {
  const random = simRandom(seed);
  const store = await openStore(seed);
  const setup = random.fork("setup");
  for (let i = 0; i < 4; i += 1) {
    const product = await newProduct(store, setup);
    if (setup.chance(0.5))
      await receiveStock(store, product.id, Decimal.of(String(setup.int(1, 5))));
  }

  const network = createSimulatedNetwork({
    baseUrl,
    random: random.fork("network"),
    fetch: realFetch,
  });
  const failures: string[] = [];
  for (let i = 1; i <= DEVICES; i += 1) {
    const name = `D${String(i)}`;
    devices.push(
      await openDevice(store, name, random.fork(name), network.link(name, FAULTS), failures),
    );
  }
  const started = performance.now();
  const actions: SimAction[] = [
    {
      name: "sell",
      weight: 35,
      async run(step) {
        const device = step.pick(devices);
        const products = await listLocalProducts(device.db);
        if (products.length === 0) return `${device.name} has no products yet`;
        for (const product of step.shuffle(products).slice(0, step.int(1, 3))) {
          for (let n = step.int(1, 3); n > 0; n -= 1) await addToCart(device.db, product.id);
        }
        const sale = await completeCashSale(device.db, {
          device: device.local,
          userId: store.tenant.ownerId,
          clock: device.clock,
          newId: device.newId,
        });
        return `${device.name} sold ${sale.number} for ${sale.total.amount.toString()}`;
      },
    },
    {
      name: "sync",
      weight: 25,
      async run(step) {
        const device = step.pick(devices);
        await device.engine.syncNow();
        const status = device.engine.status();
        return `${device.name} ${status.phase}, ${String(status.pending)} pending`;
      },
    },
    {
      name: "burst",
      weight: 6,
      async run() {
        // Every device syncs at once while stale requests land: concurrent pushes and pulls.
        const [late] = await Promise.all([
          network.deliverLate({ fraction: 0.5 }),
          ...devices.map((device) => device.engine.syncNow()),
        ]);
        return `all devices synced, ${String(late)} late requests landed`;
      },
    },
    {
      name: "outage",
      weight: 8,
      run(step) {
        const device = step.pick(devices);
        device.link.offline = !device.link.offline;
        return Promise.resolve(`${device.name} ${device.link.offline ? "offline" : "online"}`);
      },
    },
    {
      name: "late",
      weight: 8,
      async run() {
        return `${String(await network.deliverLate({ fraction: 0.5 }))} late requests landed`;
      },
    },
    {
      name: "product",
      weight: 4,
      async run(step) {
        const product = await newProduct(store, step);
        return `owner added ${product.id}`;
      },
    },
    {
      name: "receive",
      weight: 4,
      async run(step) {
        const productId = step.pick(store.productIds);
        const quantity = Decimal.of(String(step.int(1, 20)));
        await receiveStock(store, productId, quantity);
        return `received ${quantity.toString()} of ${productId}`;
      },
    },
  ];

  const trace = await runSimulation({
    random,
    steps: STEPS,
    actions,
    beforeStep: (step) => serverClock.advance(step.int(1, 20) * 60_000),
  });

  const convergeRounds = await converge({
    network,
    devices: devices.map((device) => ({
      name: device.name,
      sync: () => device.engine.syncNow(),
      pending: async () => (await outboxCounts(device.db)).pending,
    })),
  });

  const snapshots = await Promise.all(devices.map(deviceSnapshot));
  const problems = convergenceProblems({
    devices: snapshots,
    server: await serverSnapshot(store),
    received: store.received,
  });
  const elapsedMs = performance.now() - started;
  const outboxStates: Record<string, number> = {};
  for (const invoice of snapshots.flatMap((snapshot) => snapshot.invoices)) {
    const state = invoice.syncState ?? "missing";
    outboxStates[state] = (outboxStates[state] ?? 0) + 1;
  }
  const total = network.stats()["total"];
  if (total === undefined) throw new Error("no network totals");
  return {
    trace,
    problems,
    failures,
    network: total,
    outboxStates,
    invoices: snapshots.reduce((sum, snapshot) => sum + snapshot.invoices.length, 0),
    convergeRounds,
    elapsedMs,
  };
}

describe("the sync simulation harness", () => {
  it.each(SEEDS)(
    "converges with no lost or duplicate invoices and a balanced ledger (seed %i)",
    async (seed) => {
      const result = await simulate(seed);
      const context = `seed ${String(seed)} — replay with SYNC_SIM_SEEDS=${String(seed)}\n  ${result.trace.slice(-10).join("\n  ")}`;

      // Joined, so a failure prints every problem, not a collapsed array.
      expect(result.problems.join("\n"), context).toBe("");
      expect(result.failures.join("\n"), context).toBe("");
      // No request the network mangled made the server fail, even where nobody saw the answer.
      expect(result.network.serverErrors, context).toBe(0);
      // The run exercised what it claims: sales, and every kind of fault.
      expect(result.invoices, context).toBeGreaterThan(20);
      for (const counter of [
        "offline",
        "droppedRequests",
        "droppedResponses",
        "duplicated",
        "delayed",
        "lateDelivered",
      ] as const) {
        expect(result.network[counter], `${counter} — ${context}`).toBeGreaterThan(0);
      }
      // An answer was lost after the server recorded the sale, and the resend came back as a
      // duplicate: the idempotency path ran, not just the happy one.
      expect(result.outboxStates["duplicate"] ?? 0, context).toBeGreaterThan(0);
      expect(result.elapsedMs, `time budget — ${context}`).toBeLessThan(BUDGET_MS);
      console.info(
        `sync-sim seed ${String(seed)}: ${String(STEPS)} steps, ${String(result.invoices)} invoices ${JSON.stringify(result.outboxStates)}, converged in ${String(result.convergeRounds)} rounds, ${String(Math.round(result.elapsedMs))} ms; network ${JSON.stringify(result.network)}`,
      );
    },
    BUDGET_MS + 60_000,
  );
});
