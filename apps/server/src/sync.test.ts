import { accessProblemCodes } from "@mustawfi/core-access/shared";
import { hostProblemCodes, problemDetailsSchema } from "@mustawfi/core-config/shared";
import { authenticateDevice } from "@mustawfi/core-access/server";
import {
  createSyncOperationTable,
  flagOperation,
  pushOperations,
} from "@mustawfi/core-sync/server";
import {
  syncProblemCodes,
  type OperationResult,
  type PullResponse,
  type PushResponse,
  type SyncOperation,
} from "@mustawfi/core-sync/shared";
import { openTenantDatabase, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import { createProduct, moveStock } from "@mustawfi/inventory/server";
import type { ProductView } from "@mustawfi/inventory/shared";
import { cryptoRandom, Decimal, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { SKELETON_DOCUMENT_DEFAULTS, salesProblemCodes } from "@mustawfi/sales/shared";
import { createTestDatabase, sqlState, type TestDatabase } from "@mustawfi/testing";
import { sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHostServer } from "./host-server.ts";
import { applyMigrations } from "./db/migrate.ts";
import { migrationSets } from "./db/migration-sets.ts";
import { createServerRegistry, serverPermissions } from "./modules.ts";
import { invoiceOperation, type InvoiceLineSpec } from "./sales-operations.test-helpers.ts";
import type { CreatedTenant } from "./tenants/create-tenant.ts";
import { createStaffUser, signInAs } from "./staff.test-helpers.ts";
import { createLicensedTenant } from "./tenants/licensed-tenant.test-helpers.ts";

const PASSWORD = "correct horse battery staple";
const clock = manualClock(new Date("2026-09-25T10:00:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const dependencies = { clock, newId, random: cryptoRandom };

let database: TestDatabase;
let tenants: TenantDatabase;
let server: FastifyInstance;
let superuser: pg.Client;

interface Store {
  readonly tenant: CreatedTenant;
  readonly token: string;
}

interface TestDevice {
  readonly deviceId: string;
  readonly prefix: string;
  readonly credential: string;
  readonly store: Store;
  /** The next `deviceSeq` this test device uses. */
  seq: number;
}

beforeAll(async () => {
  database = await createTestDatabase("sync");
  await applyMigrations(database.url("owner"), migrationSets);
  tenants = await openTenantDatabase({ connectionString: database.url("app") });
  superuser = await database.connect("superuser");
  const registry = createServerRegistry();
  server = await buildHostServer({
    registry,
    services: { ...dependencies, tenants },
  });
});

afterAll(async () => {
  await server.close();
  await superuser.end();
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
  expect(issued.statusCode).toBe(201);
  const registered = await server.inject({
    method: "POST",
    url: "/api/v1/access/devices",
    payload: {
      storeCode: store.tenant.storeCode,
      registrationCode: issued.json<{ code: string }>().code,
      type: "mainPos",
      name: "الصندوق الرئيسي",
    },
  });
  expect(registered.statusCode).toBe(201);
  return { ...registered.json<Omit<TestDevice, "store" | "seq">>(), store, seq: 1 };
}

async function newProduct(store: Store, price = "1250.50"): Promise<ProductView> {
  const response = await server.inject({
    method: "POST",
    url: "/api/v1/inventory/products",
    headers: { authorization: `Bearer ${store.token}` },
    payload: { name: `منتج ${newId().slice(-6)}`, price: { amount: price, currency: "SYP" } },
  });
  expect(response.statusCode).toBe(201);
  return response.json<ProductView>();
}

/** Puts `quantity` of a product on hand, as a stock receipt would. */
function receiveStock(store: Store, productId: string, quantity: string) {
  const { tenantId, branchId, ownerId } = store.tenant;
  return tenants.withTenant({ tenantId, userId: ownerId }, (tx) =>
    moveStock(
      tx,
      {
        tenantId,
        branchId,
        createdAt: clock.now(),
        createdBy: ownerId,
        source: { type: "inventory.receipt", id: newId() },
        movements: [{ productId, quantity: Decimal.of(quantity) }],
      },
      dependencies,
    ),
  );
}

/** The device's next sale, taking the next `deviceSeq` and invoice number. */
function sale(
  device: TestDevice,
  lines: readonly InvoiceLineSpec[],
  extra: Partial<Parameters<typeof invoiceOperation>[0]> = {},
): SyncOperation {
  const deviceSeq = device.seq;
  device.seq += 1;
  return invoiceOperation({
    newId,
    device,
    userId: device.store.tenant.ownerId,
    departmentId: device.store.tenant.defaultDepartmentId,
    deviceSeq,
    lines,
    ...extra,
  });
}

function invoicesOf(store: Store | null) {
  return server.inject({
    method: "GET",
    url: "/api/v1/sales/invoices",
    ...(store === null ? {} : { headers: { authorization: `Bearer ${store.token}` } }),
  });
}

function pushRaw(body: unknown, credential: string | null) {
  return server.inject({
    method: "POST",
    url: "/api/v1/sync/push",
    payload: body as Record<string, unknown>,
    ...(credential === null ? {} : { headers: { authorization: `Bearer ${credential}` } }),
  });
}

async function push(device: TestDevice, operations: readonly SyncOperation[]) {
  const response = await pushRaw({ operations }, device.credential);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<PushResponse>();
}

async function pull(device: TestDevice, query = "") {
  const response = await server.inject({
    method: "GET",
    url: `/api/v1/sync/pull${query}`,
    headers: { authorization: `Bearer ${device.credential}` },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<PullResponse>();
}

function expectProblem(
  response: { statusCode: number; json(): unknown },
  status: number,
  code: string,
) {
  expect(response.statusCode).toBe(status);
  expect(problemDetailsSchema.parse(response.json())).toMatchObject({ status, code });
}

async function count(table: string, where: string, values: unknown[]): Promise<number> {
  const { rows } = await superuser.query<{ n: number }>(
    `select count(*)::int as n from ${table} where ${where}`,
    values,
  );
  return rows[0]?.n ?? -1;
}

const invoiceIdOf = (operation: SyncOperation) => (operation.payload as { id: string }).id;

function accepted(result: OperationResult | undefined) {
  expect(result?.status).toBe("accepted");
  return (result as Extract<OperationResult, { status: "accepted" }>).result as {
    invoiceId: string;
    number: string;
    journalEntryId: string | null;
    flags: string[];
  };
}

describe("POST /api/v1/sync/push", () => {
  let store: Store;
  let device: TestDevice;
  let product: ProductView;

  beforeAll(async () => {
    store = await newStore("متجر النور");
    device = await newDevice(store);
    product = await newProduct(store);
    await receiveStock(store, product.id, "10");
  });

  it("records a sale as the device recorded it, with its balanced journal entry", async () => {
    const operation = sale(device, [
      { productId: product.id, quantity: "2", unitPrice: "1250.50" },
    ]);
    const response = await push(device, [operation]);
    const result = accepted(response.results[0]);
    expect(response).toMatchObject({ nextDeviceSeq: operation.deviceSeq + 1, gap: false });
    expect(result).toMatchObject({
      invoiceId: invoiceIdOf(operation),
      number: `${device.prefix}-INV-000001`,
      flags: [],
    });

    const invoice = await superuser.query(
      `select tenant_id, branch_id, created_at, created_by, number, device_id, doc_seq, op_id,
              business_date::text, sold_at, currency, exchange_rate, department_id, shift_id,
              template_version, total
         from sales.invoices where id = $1`,
      [result.invoiceId],
    );
    expect(invoice.rows).toEqual([
      {
        tenant_id: store.tenant.tenantId,
        branch_id: store.tenant.branchId,
        created_at: clock.now(),
        created_by: store.tenant.ownerId,
        number: result.number,
        device_id: device.deviceId,
        doc_seq: "1",
        op_id: operation.opId,
        business_date: "2026-09-25",
        sold_at: new Date(operation.createdAt),
        currency: "SYP",
        exchange_rate: "1.000000",
        department_id: store.tenant.defaultDepartmentId,
        shift_id: SKELETON_DOCUMENT_DEFAULTS.shiftId,
        template_version: "receipt.cash.2",
        total: "2501.0000",
      },
    ]);
    const lines = await superuser.query(
      "select line_no, product_id, quantity, unit_price, amount from sales.invoice_lines where invoice_id = $1",
      [result.invoiceId],
    );
    expect(lines.rows).toEqual([
      {
        line_no: 1,
        product_id: product.id,
        quantity: "2.0000",
        unit_price: "1250.500000",
        amount: "2501.0000",
      },
    ]);

    // Debit cash, credit sales revenue, on the invoice's department and day.
    const journal = await superuser.query(
      `select e.id, e.accounting_date::text, e.source_type, e.source_id, e.created_by,
              a.system_key, l.debit, l.credit, l.department_id, l.currency
         from core_ledger.journal_entries e
         join core_ledger.journal_lines l on l.journal_entry_id = e.id
         join core_ledger.accounts a on a.id = l.account_id
        where e.source_id = $1 order by l.line_no`,
      [result.invoiceId],
    );
    const common = {
      id: result.journalEntryId,
      accounting_date: "2026-09-25",
      source_type: "sales.invoice",
      source_id: result.invoiceId,
      created_by: store.tenant.ownerId,
      department_id: store.tenant.defaultDepartmentId,
      currency: "SYP",
    };
    expect(journal.rows).toEqual([
      { ...common, system_key: "cash", debit: "2501.0000", credit: "0.0000" },
      { ...common, system_key: "salesRevenue", debit: "0.0000", credit: "2501.0000" },
    ]);

    const stock = await superuser.query(
      `select (select on_hand from inventory.stock_levels where product_id = $1) as on_hand,
              (select quantity from inventory.stock_movements where source_id = $2) as moved`,
      [product.id, result.invoiceId],
    );
    expect(stock.rows).toEqual([{ on_hand: "8.0000", moved: "-2.0000" }]);
    expect(
      await count("core_audit.entries", "action = 'sales.invoice.created' and entity_id = $1", [
        result.invoiceId,
      ]),
    ).toBe(1);
    const received = await superuser.query(
      "select status, device_seq, created_by from core_sync.received_ops where id = $1",
      [operation.opId],
    );
    expect(received.rows).toEqual([
      { status: "accepted", device_seq: "1", created_by: store.tenant.ownerId },
    ]);
  });

  it("answers a repeated opId with the stored result and records one invoice", async () => {
    const operation = sale(device, [
      { productId: product.id, quantity: "1", unitPrice: "1250.50" },
    ]);
    const first = await push(device, [operation]);
    const again = await push(device, [operation]);
    expect(again.results).toEqual([{ ...first.results[0], status: "duplicate" }]);
    expect(again.nextDeviceSeq).toBe(first.nextDeviceSeq);

    // Two pushes of one new operation at the same moment: one records it.
    const racing = sale(device, [{ productId: product.id, quantity: "1", unitPrice: "1250.50" }]);
    const both = await Promise.all([push(device, [racing]), push(device, [racing])]);
    expect(both.map((r) => r.results[0]?.status).sort()).toEqual(["accepted", "duplicate"]);

    for (const op of [operation, racing]) {
      expect(await count("sales.invoices", "op_id = $1", [op.opId])).toBe(1);
      expect(await count("core_ledger.journal_entries", "source_id = $1", [invoiceIdOf(op)])).toBe(
        1,
      );
      expect(await count("inventory.stock_movements", "source_id = $1", [invoiceIdOf(op)])).toBe(1);
    }
  });

  it("takes a device's operations one at a time: a racing one waits for the one in flight", async () => {
    // A fixture operation whose handler holds its transaction open until released, so the
    // race is certain rather than a matter of timing.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = () => {};
    const inFlight = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const operations = createSyncOperationTable(
      [
        {
          type: "test.hold.post",
          access: "device",
          versions: {
            1: async (_, operation) => {
              if (operation.payload.hold === true) {
                entered();
                await held;
              }
              return { held: operation.payload.hold === true };
            },
          },
        },
      ],
      serverPermissions(),
    );
    const deviceOf = await authenticateDevice(tenants, device.credential);
    if (deviceOf === undefined) throw new Error("the test device does not authenticate");
    const operation = (hold: boolean): SyncOperation => ({
      ...sale(device, [{ productId: product.id, quantity: "1", unitPrice: "1" }]),
      type: "test.hold.post",
      payload: { hold },
    });
    const first = operation(true);
    const rival = { ...operation(false), deviceSeq: first.deviceSeq };
    device.seq -= 1; // `rival` reuses `first`'s number.
    const pushOne = (op: SyncOperation) =>
      pushOperations(tenants, deviceOf, [op], { ...dependencies, operations });

    const firstPush = pushOne(first);
    await inFlight;
    const rivalPush = pushOne(rival);
    const repeatPush = pushOne(first);
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    const [one, two, three] = await Promise.all([firstPush, rivalPush, repeatPush]);

    expect(one.results).toEqual([expect.objectContaining({ status: "accepted" })]);
    expect(two.results).toEqual([
      expect.objectContaining({ status: "rejected", code: syncProblemCodes.seqTaken }),
    ]);
    expect(three.results).toEqual([
      expect.objectContaining({ status: "duplicate", result: { held: true } }),
    ]);
    expect(await count("core_sync.received_ops", "id in ($1, $2)", [first.opId, rival.opId])).toBe(
      1,
    );
  });

  it("stops at a gap in deviceSeq and takes the operations once they are resent", async () => {
    const till = await newDevice(store);
    const line = { productId: product.id, quantity: "1", unitPrice: "1250.50" };
    const [first, second, third, fourth] = [1, 2, 3, 4].map(() => sale(till, [line]));
    if (
      first === undefined ||
      second === undefined ||
      third === undefined ||
      fourth === undefined
    ) {
      throw new Error("four operations");
    }

    const gapped = await push(till, [fourth, first, third]);
    expect(gapped.results.map((r) => [r.deviceSeq, r.status])).toEqual([[1, "accepted"]]);
    expect(gapped).toMatchObject({ nextDeviceSeq: 2, gap: true });
    for (const op of [third, fourth]) {
      expect(await count("core_sync.received_ops", "id = $1", [op.opId])).toBe(0);
      expect(await count("sales.invoices", "op_id = $1", [op.opId])).toBe(0);
    }

    const resent = await push(till, [third, second, fourth]);
    expect(resent.results.map((r) => [r.deviceSeq, r.status])).toEqual([
      [2, "accepted"],
      [3, "accepted"],
      [4, "accepted"],
    ]);
    expect(resent).toMatchObject({ nextDeviceSeq: 5, gap: false });
  });

  it("accepts a sale beyond the stock and flags it", async () => {
    const scarce = await newProduct(store, "500");
    await receiveStock(store, scarce.id, "1");
    const operation = sale(device, [{ productId: scarce.id, quantity: "3", unitPrice: "500" }]);
    const result = accepted((await push(device, [operation])).results[0]);
    expect(result.flags).toEqual(["negativeStock"]);
    expect(result.journalEntryId).not.toBeNull();

    const flags = await superuser.query(
      "select code, detail, created_by from sales.invoice_flags where invoice_id = $1",
      [result.invoiceId],
    );
    expect(flags.rows).toEqual([
      {
        code: "negativeStock",
        detail: { productId: scarce.id, onHand: "-2" },
        created_by: store.tenant.ownerId,
      },
    ]);
    const level = await superuser.query(
      "select on_hand from inventory.stock_levels where product_id = $1",
      [scarce.id],
    );
    expect(level.rows).toEqual([{ on_hand: "-2.0000" }]);
    expect(await count("sales.invoices", "id = $1", [result.invoiceId])).toBe(1);
  });

  it("accepts arithmetic that does not add up, flags it, and posts what the customer paid", async () => {
    const operation = sale(
      device,
      [
        { productId: product.id, quantity: "1", unitPrice: "1250.50", amount: "1200" },
        { productId: product.id, quantity: "1", unitPrice: "1250.50" },
      ],
      { total: "2400" },
    );
    const result = accepted((await push(device, [operation])).results[0]);
    expect(result.flags).toEqual(["arithmeticMismatch"]);
    const flag = await superuser.query(
      "select detail from sales.invoice_flags where invoice_id = $1 and code = 'arithmeticMismatch'",
      [result.invoiceId],
    );
    expect(flag.rows).toEqual([{ detail: { lines: [1], linesTotal: "2450.5", total: "2400" } }]);
    const posted = await superuser.query(
      "select sum(debit) as debits, sum(credit) as credits from core_ledger.journal_lines where journal_entry_id = $1",
      [result.journalEntryId],
    );
    expect(posted.rows).toEqual([{ debits: "2400.0000", credits: "2400.0000" }]);
  });

  it("records a free sale without a journal entry", async () => {
    const free = await newProduct(store, "0");
    await receiveStock(store, free.id, "5");
    const operation = sale(device, [{ productId: free.id, quantity: "1", unitPrice: "0" }]);
    const result = accepted((await push(device, [operation])).results[0]);
    expect(result).toMatchObject({ journalEntryId: null, flags: [] });
    expect(await count("core_ledger.journal_entries", "source_id = $1", [result.invoiceId])).toBe(
      0,
    );
  });

  describe("rejects what cannot be recorded, stores the rejection, and moves on", () => {
    const cases: [string, string, (d: TestDevice, p: ProductView) => SyncOperation][] = [
      [
        "a product the store does not have",
        salesProblemCodes.unknownProduct,
        (d) => sale(d, [{ productId: newId(), quantity: "1", unitPrice: "1" }]),
      ],
      [
        "a number with another device's prefix",
        salesProblemCodes.numberMismatch,
        (d, p) =>
          sale(d, [{ productId: p.id, quantity: "1", unitPrice: "1" }], {
            device: { deviceId: d.deviceId, prefix: d.prefix === "ZZ" ? "YY" : "ZZ" },
          }),
      ],
      [
        "a number not in its canonical form",
        salesProblemCodes.numberMismatch,
        (d, p) =>
          sale(d, [{ productId: p.id, quantity: "1", unitPrice: "1" }], {
            payload: { number: `${d.prefix}-INV-12` },
          }),
      ],
      [
        "a department the store does not have",
        salesProblemCodes.unknownDepartment,
        (d, p) =>
          sale(d, [{ productId: p.id, quantity: "1", unitPrice: "1" }], { departmentId: newId() }),
      ],
      [
        "a number with another document code",
        salesProblemCodes.numberMismatch,
        (d, p) =>
          sale(d, [{ productId: p.id, quantity: "1", unitPrice: "1" }], {
            payload: { number: `${d.prefix}-RET-000001` },
          }),
      ],
      [
        "another currency than the base currency",
        salesProblemCodes.unsupportedCurrency,
        (d, p) =>
          sale(d, [{ productId: p.id, quantity: "1", unitPrice: "1" }], {
            payload: { currency: "USD", exchangeRate: "14000" },
          }),
      ],
      [
        "a quantity as a JSON number",
        salesProblemCodes.invoiceInvalid,
        (d, p) =>
          sale(d, [{ productId: p.id, quantity: "1", unitPrice: "1" }], {
            payload: {
              lines: [{ id: newId(), productId: p.id, quantity: 1, unitPrice: "1", amount: "1" }],
            },
          }),
      ],
      [
        "a total finer than the minor unit",
        salesProblemCodes.invoiceInvalid,
        (d, p) =>
          sale(d, [{ productId: p.id, quantity: "1", unitPrice: "1.005" }], { total: "1.005" }),
      ],
      [
        "an operation type this server does not handle",
        syncProblemCodes.unsupportedType,
        (d, p) =>
          sale(d, [{ productId: p.id, quantity: "1", unitPrice: "1" }], {
            envelope: { type: "sales.invoice.teleport" },
          }),
      ],
      [
        "a payload version this server does not handle",
        syncProblemCodes.unsupportedVersion,
        (d, p) =>
          sale(d, [{ productId: p.id, quantity: "1", unitPrice: "1" }], {
            envelope: { payloadVersion: 2 },
          }),
      ],
      [
        "a user of another store",
        syncProblemCodes.unknownUser,
        (d, p) =>
          sale(d, [{ productId: p.id, quantity: "1", unitPrice: "1" }], { userId: newId() }),
      ],
    ];

    it.each(cases)("%s", async (_, code, build) => {
      const operation = build(device, product);
      const response = await push(device, [operation]);
      expect(response.results).toEqual([
        expect.objectContaining({ opId: operation.opId, status: "rejected", code }),
      ]);
      expect(response.nextDeviceSeq).toBe(operation.deviceSeq + 1);
      const stored = await superuser.query(
        "select status, problem_code, payload from core_sync.received_ops where id = $1",
        [operation.opId],
      );
      expect(stored.rows).toEqual([
        { status: "rejected", problem_code: code, payload: operation.payload },
      ]);
      expect(await count("sales.invoices", "op_id = $1", [operation.opId])).toBe(0);
      expect(
        await count("inventory.stock_movements", "source_id = $1", [invoiceIdOf(operation)]),
      ).toBe(0);

      // Pushed again, it gets the same answer; the device's next operation goes through.
      expect((await push(device, [operation])).results).toEqual(response.results);
      const next = sale(device, [{ productId: product.id, quantity: "1", unitPrice: "1250.50" }]);
      accepted((await push(device, [next])).results[0]);
    });

    it("an invoice another operation already recorded", async () => {
      const original = sale(device, [
        { productId: product.id, quantity: "1", unitPrice: "1250.50" },
      ]);
      accepted((await push(device, [original])).results[0]);
      const copy = sale(device, [{ productId: product.id, quantity: "1", unitPrice: "1250.50" }], {
        payload: {
          id: invoiceIdOf(original),
          number: (original.payload as { number: string }).number,
        },
      });
      const response = await push(device, [copy]);
      expect(response.results[0]).toMatchObject({
        status: "rejected",
        code: salesProblemCodes.duplicate,
      });
      expect(await count("sales.invoices", "id = $1", [invoiceIdOf(original)])).toBe(1);
      expect(
        await count("core_ledger.journal_entries", "source_id = $1", [invoiceIdOf(original)]),
      ).toBe(1);
    });

    it("a new operation on a deviceSeq another one holds, without storing it", async () => {
      const taken = sale(device, [{ productId: product.id, quantity: "1", unitPrice: "1250.50" }], {
        deviceSeq: 1,
      });
      device.seq -= 1; // `deviceSeq: 1` replaced the number `sale` took.
      const response = await push(device, [taken]);
      expect(response.results[0]).toMatchObject({
        status: "rejected",
        code: syncProblemCodes.seqTaken,
      });
      expect(response.nextDeviceSeq).toBe(device.seq);
      expect(await count("core_sync.received_ops", "id = $1", [taken.opId])).toBe(0);
    });
  });

  it("stores nothing when posting fails, so the device retries", async () => {
    const shop = await newStore("متجر بلا صندوق");
    const till = await newDevice(shop);
    const item = await newProduct(shop);
    await receiveStock(shop, item.id, "5");
    // Take the tenant's cash account away past the app role, so posting fails mid-operation.
    const { rows } = await superuser.query<{ row: Record<string, unknown> }>(
      "select to_jsonb(a) as row from core_ledger.accounts a where tenant_id = $1 and system_key = 'cash'",
      [shop.tenant.tenantId],
    );
    await superuser.query("delete from core_ledger.accounts where id = $1", [rows[0]?.row.id]);

    const operation = sale(till, [{ productId: item.id, quantity: "1", unitPrice: "1250.50" }]);
    const failed = await pushRaw({ operations: [operation] }, till.credential);
    expectProblem(failed, 500, hostProblemCodes.internal);
    const invoiceId = invoiceIdOf(operation);
    expect(await count("core_sync.received_ops", "id = $1", [operation.opId])).toBe(0);
    expect(await count("sales.invoices", "id = $1", [invoiceId])).toBe(0);
    expect(await count("sales.invoice_lines", "invoice_id = $1", [invoiceId])).toBe(0);
    expect(await count("inventory.stock_movements", "source_id = $1", [invoiceId])).toBe(0);
    expect(await count("core_audit.entries", "entity_id = $1", [invoiceId])).toBe(0);
    const level = await superuser.query(
      "select on_hand from inventory.stock_levels where product_id = $1",
      [item.id],
    );
    expect(level.rows).toEqual([{ on_hand: "5.0000" }]);

    await superuser.query(
      "insert into core_ledger.accounts select * from jsonb_populate_record(null::core_ledger.accounts, $1)",
      [JSON.stringify(rows[0]?.row)],
    );
    accepted((await push(till, [operation])).results[0]);
  });

  it("refuses a push without a device credential, or with another device's operation", async () => {
    const operation = sale(device, [{ productId: product.id, quantity: "1", unitPrice: "1" }]);
    device.seq -= 1;
    const body = { operations: [operation] };
    expectProblem(await pushRaw(body, null), 401, accessProblemCodes.deviceRequired);
    expectProblem(await pushRaw(body, store.token), 401, accessProblemCodes.deviceRequired);
    expectProblem(await pushRaw(body, "d1.nonsense"), 401, accessProblemCodes.deviceRequired);

    const other = await newDevice(store);
    expectProblem(await pushRaw(body, other.credential), 422, syncProblemCodes.wrongDevice);
    expect(await count("core_sync.received_ops", "id = $1", [operation.opId])).toBe(0);
  });

  it.each([
    ["no operations", { operations: [] }],
    ["an opId that is not a UUID", { operations: [{ opId: "x" }] }],
  ])("refuses a malformed push: %s", async (_, body) => {
    expectProblem(await pushRaw(body, device.credential), 400, hostProblemCodes.invalidRequest);
  });

  it("keeps a device to its own store's products", async () => {
    const rival = await newStore("متجر منافس");
    const theirs = await newDevice(rival);
    const operation = sale(theirs, [{ productId: product.id, quantity: "1", unitPrice: "1" }]);
    const response = await push(theirs, [operation]);
    expect(response.results[0]).toMatchObject({
      status: "rejected",
      code: salesProblemCodes.unknownProduct,
    });
  });

  it("keeps a device to its own store's departments", async () => {
    const rival = await newStore("متجر منافس آخر");
    const theirs = await newDevice(rival);
    const item = await newProduct(rival);
    const operation = sale(theirs, [{ productId: item.id, quantity: "1", unitPrice: "1" }], {
      departmentId: store.tenant.defaultDepartmentId,
    });
    const response = await push(theirs, [operation]);
    expect(response.results[0]).toMatchObject({
      status: "rejected",
      code: salesProblemCodes.unknownDepartment,
    });
  });

  it("records a sale under an archived department: the device sold before it heard", async () => {
    const headers = { authorization: `Bearer ${store.token}` };
    const created = await server.inject({
      method: "POST",
      url: "/api/v1/organization/departments",
      headers,
      payload: { name: "الصيانة" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const { id } = created.json<{ id: string }>();
    const archived = await server.inject({
      method: "POST",
      url: `/api/v1/organization/departments/${id}/archive`,
      headers,
    });
    expect(archived.statusCode, archived.body).toBe(200);

    const operation = sale(
      device,
      [{ productId: product.id, quantity: "1", unitPrice: "1250.50" }],
      { departmentId: id },
    );
    const result = accepted((await push(device, [operation])).results[0]);
    const recorded = await superuser.query(
      `select (select department_id from sales.invoices where id = $1) as invoice,
              (select array_agg(distinct department_id) from core_ledger.journal_lines
                where journal_entry_id = $2) as lines`,
      [result.invoiceId, result.journalEntryId],
    );
    expect(recorded.rows).toEqual([{ invoice: id, lines: [id] }]);
  });
});

describe("document numbers on ingest (core-foundation rule 31)", () => {
  let store: Store;
  let product: ProductView;

  beforeAll(async () => {
    store = await newStore("متجر الترقيم");
    product = await newProduct(store);
    await receiveStock(store, product.id, "100");
  });

  const line = () => ({ productId: product.id, quantity: "1", unitPrice: "1250.50" });

  async function flagsOf(opId: string): Promise<unknown[]> {
    const { rows } = await superuser.query<Record<string, unknown>>(
      "select code, detail, created_by from core_sync.operation_flags where op_id = $1",
      [opId],
    );
    return rows;
  }

  async function sequencesOf(device: TestDevice): Promise<unknown[]> {
    const { rows } = await superuser.query<Record<string, unknown>>(
      "select doc_code, last_seq from core_organization.document_sequences where device_id = $1",
      [device.deviceId],
    );
    return rows;
  }

  async function gapAuditsOf(device: TestDevice): Promise<unknown[]> {
    const { rows } = await superuser.query<Record<string, unknown>>(
      `select created_by, device_id, entity_type, entity_id, after
         from core_audit.entries
        where action = 'organization.numbering.gap' and device_id = $1
        order by created_at, id`,
      [device.deviceId],
    );
    return rows;
  }

  it("tracks the last sequence per device and code, and flags nothing in order", async () => {
    const device = await newDevice(store);
    const operations = [sale(device, [line()]), sale(device, [line()])];
    const response = await push(device, operations);
    expect(response.results.map((r) => r.status)).toEqual(["accepted", "accepted"]);
    for (const op of operations) expect(await flagsOf(op.opId)).toEqual([]);
    expect(await sequencesOf(device)).toEqual([{ doc_code: "INV", last_seq: "2" }]);
    expect(await gapAuditsOf(device)).toEqual([]);
  });

  it("accepts a jump, flags it numberGap, and audits the missing range once", async () => {
    const device = await newDevice(store);
    accepted((await push(device, [sale(device, [line()])])).results[0]);
    const jump = sale(device, [line()], { invoiceSeq: 5 });
    const result = accepted((await push(device, [jump])).results[0]);
    expect(result.number).toBe(`${device.prefix}-INV-000005`);

    const detail = {
      docCode: "INV",
      first: `${device.prefix}-INV-000002`,
      last: `${device.prefix}-INV-000004`,
      count: 3,
      number: `${device.prefix}-INV-000005`,
    };
    expect(await flagsOf(jump.opId)).toEqual([
      { code: "numberGap", detail, created_by: store.tenant.ownerId },
    ]);
    expect(await gapAuditsOf(device)).toEqual([
      {
        created_by: store.tenant.ownerId,
        device_id: device.deviceId,
        entity_type: "sales.invoice",
        entity_id: result.invoiceId,
        after: detail,
      },
    ]);
    expect(await sequencesOf(device)).toEqual([{ doc_code: "INV", last_seq: "5" }]);

    // A retry is answered from the record: no second flag, no second entry.
    expect((await push(device, [jump])).results[0]?.status).toBe("duplicate");
    expect(await flagsOf(jump.opId)).toHaveLength(1);
    expect(await gapAuditsOf(device)).toHaveLength(1);
  });

  it("takes a late number inside a reported gap without moving the sequence back", async () => {
    const device = await newDevice(store);
    accepted((await push(device, [sale(device, [line()], { invoiceSeq: 3 })])).results[0]);
    const late = sale(device, [line()], { invoiceSeq: 2 });
    accepted((await push(device, [late])).results[0]);
    expect(await flagsOf(late.opId)).toEqual([]);
    expect(await sequencesOf(device)).toEqual([{ doc_code: "INV", last_seq: "3" }]);
    expect(await gapAuditsOf(device)).toHaveLength(1);
  });

  it("counts nothing for a repeated number, which is refused as a duplicate", async () => {
    const device = await newDevice(store);
    accepted((await push(device, [sale(device, [line()])])).results[0]);
    const repeat = sale(device, [line()], { invoiceSeq: 1 });
    expect((await push(device, [repeat])).results[0]).toMatchObject({
      status: "rejected",
      code: salesProblemCodes.duplicate,
    });
    expect(await flagsOf(repeat.opId)).toEqual([]);
    expect(await sequencesOf(device)).toEqual([{ doc_code: "INV", last_seq: "1" }]);
  });

  it("keeps one flag per code when an operation is flagged twice, and records it", async () => {
    const device = await newDevice(store);
    const operations = createSyncOperationTable(
      [
        {
          type: "test.flag.post",
          access: "device",
          versions: {
            1: async (tx, operation, handlerDependencies) => {
              for (const detail of [{ first: true }, { first: false }]) {
                await flagOperation(
                  tx,
                  operation,
                  { code: "numberGap", detail },
                  handlerDependencies,
                );
              }
              return {};
            },
          },
        },
      ],
      serverPermissions(),
    );
    const deviceOf = await authenticateDevice(tenants, device.credential);
    if (deviceOf === undefined) throw new Error("the test device does not authenticate");
    const operation: SyncOperation = {
      ...sale(device, [line()]),
      type: "test.flag.post",
      payload: {},
    };
    const pushed = await pushOperations(tenants, deviceOf, [operation], {
      ...dependencies,
      operations,
    });
    expect(pushed.results.map((r) => r.status)).toEqual(["accepted"]);
    expect(await flagsOf(operation.opId)).toEqual([
      { code: "numberGap", detail: { first: true }, created_by: store.tenant.ownerId },
    ]);
  });

  it("keeps each device's numbering apart", async () => {
    const first = await newDevice(store);
    const second = await newDevice(store);
    const pushed = await push(first, [sale(first, [line()]), sale(first, [line()])]);
    expect(pushed.results.map((r) => r.status)).toEqual(["accepted", "accepted"]);
    const opening = sale(second, [line()]);
    accepted((await push(second, [opening])).results[0]);
    expect(await flagsOf(opening.opId)).toEqual([]);
    expect(await sequencesOf(second)).toEqual([{ doc_code: "INV", last_seq: "1" }]);
  });
});

describe("permissions on ingest (core-foundation rule 17)", () => {
  let store: Store;
  let product: ProductView;
  let device: TestDevice;
  let otherDepartmentId: string;

  beforeAll(async () => {
    store = await newStore("متجر الصلاحيات");
    product = await newProduct(store);
    await receiveStock(store, product.id, "100");
    device = await newDevice(store);
    const added = await server.inject({
      method: "POST",
      url: "/api/v1/organization/departments",
      headers: { authorization: `Bearer ${store.token}` },
      payload: { name: "الإكسسوارات" },
    });
    expect(added.statusCode).toBe(201);
    otherDepartmentId = added.json<{ id: string }>().id;
  });

  const line = () => ({ productId: product.id, quantity: "1", unitPrice: "100" });

  async function permissionFlagsOf(opId: string): Promise<unknown[]> {
    const { rows } = await superuser.query<Record<string, unknown>>(
      "select code, detail from core_sync.operation_flags where op_id = $1 and code = 'permissionMissing'",
      [opId],
    );
    return rows;
  }

  it("records every sale, and flags one sold outside the seller's permission or departments", async () => {
    const cashier = await createStaffUser(
      tenants,
      store.tenant,
      {
        login: "section.cashier",
        permissions: ["sales.invoice.create"],
        departments: [store.tenant.defaultDepartmentId],
      },
      dependencies,
    );
    const viewer = await createStaffUser(
      tenants,
      store.tenant,
      { login: "viewer", permissions: ["inventory.products.view"] },
      dependencies,
    );
    const inScope = sale(device, [line()], { userId: cashier.userId });
    const outOfScope = sale(device, [line()], {
      userId: cashier.userId,
      departmentId: otherDepartmentId,
    });
    const withoutPermission = sale(device, [line()], { userId: viewer.userId });
    const byOwner = sale(device, [line()], { departmentId: otherDepartmentId });

    const pushed = await push(device, [inScope, outOfScope, withoutPermission, byOwner]);
    expect(pushed.results.map((r) => r.status)).toEqual([
      "accepted",
      "accepted",
      "accepted",
      "accepted",
    ]);
    expect(await permissionFlagsOf(inScope.opId)).toEqual([]);
    expect(await permissionFlagsOf(byOwner.opId)).toEqual([]);
    expect(await permissionFlagsOf(outOfScope.opId)).toEqual([
      {
        code: "permissionMissing",
        detail: {
          permission: "sales.invoice.create",
          departmentId: otherDepartmentId,
          roleId: cashier.roleId,
        },
      },
    ]);
    expect(await permissionFlagsOf(withoutPermission.opId)).toEqual([
      {
        code: "permissionMissing",
        detail: {
          permission: "sales.invoice.create",
          departmentId: store.tenant.defaultDepartmentId,
          roleId: viewer.roleId,
        },
      },
    ]);
    const invoices = await invoicesOf(store);
    expect(invoices.json<{ items: unknown[] }>().items).toHaveLength(4);
  });

  it("does not flag again when a flagged operation is pushed again", async () => {
    const viewer = await createStaffUser(
      tenants,
      store.tenant,
      { login: "viewer.again", permissions: [] },
      dependencies,
    );
    const operation = sale(device, [line()], { userId: viewer.userId });
    await push(device, [operation]);
    const again = await push(device, [operation]);
    expect(again.results.map((r) => r.status)).toEqual(["duplicate"]);
    expect(await permissionFlagsOf(operation.opId)).toHaveLength(1);
  });
});

describe("GET /api/v1/sync/pull", () => {
  let store: Store;
  let device: TestDevice;

  beforeAll(async () => {
    store = await newStore("متجر السحب");
    device = await newDevice(store);
  });

  it("returns product changes in commit order, in pages, with a resumable cursor", async () => {
    // What the store was created with (its department and profile) comes first.
    const seeded = await pull(device);
    const created = [await newProduct(store), await newProduct(store), await newProduct(store)];
    const rival = await newStore("متجر آخر");
    const theirs = await newProduct(rival);

    const first = await pull(device, `?limit=2&cursor=${seeded.cursor}`);
    expect(first.changes).toEqual(
      created.slice(0, 2).map((p) => ({ entity: "inventory.product", id: p.id, row: p })),
    );
    expect(first.more).toBe(true);
    const rest = await pull(device, `?cursor=${first.cursor}`);
    expect(rest.changes).toEqual([
      { entity: "inventory.product", id: created[2]?.id, row: created[2] },
    ]);
    expect(rest.more).toBe(false);
    expect(rest.changes.map((c) => c.id)).not.toContain(theirs.id);

    const idle = await pull(device, `?cursor=${rest.cursor}`);
    expect(idle).toEqual({ changes: [], cursor: rest.cursor, more: false });

    // Another device of the store starts from the beginning and sees the same log.
    const other = await newDevice(store);
    expect((await pull(other)).changes.map((c) => c.id)).toEqual([
      ...seeded.changes.map((c) => c.id),
      ...created.map((p) => p.id),
    ]);
  });

  it("never lets a device skip a change whose transaction commits late", async () => {
    const { tenantId, branchId, ownerId } = store.tenant;
    const start = (await pull(device, "?limit=1000")).cursor;
    const write = (name: string, hold?: Promise<void>) =>
      tenants.withTenant({ tenantId, userId: ownerId }, async (tx) => {
        const product = await createProduct(
          tx,
          {
            id: newId(),
            tenantId,
            branchId,
            createdAt: clock.now(),
            createdBy: ownerId,
            name,
            price: { amount: "1", currency: "SYP" },
          },
          dependencies,
        );
        await hold;
        return product;
      });

    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = write("بطيء", held);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const fast = write("سريع");
    await new Promise((resolve) => setTimeout(resolve, 300));

    // The later write waits for the earlier one's change-log number to commit: a device pulling
    // now sees neither, rather than the later one with a hole behind it.
    expect((await pull(device, `?cursor=${start}`)).changes).toEqual([]);
    release();
    const [slowProduct, fastProduct] = await Promise.all([slow, fast]);
    const after = await pull(device, `?cursor=${start}`);
    expect(after.changes.map((c) => c.id)).toEqual([slowProduct.id, fastProduct.id]);
  });

  it("refuses a pull without a device credential or with a malformed cursor", async () => {
    const without = await server.inject({ method: "GET", url: "/api/v1/sync/pull" });
    expectProblem(without, 401, accessProblemCodes.deviceRequired);
    const session = await server.inject({
      method: "GET",
      url: "/api/v1/sync/pull",
      headers: { authorization: `Bearer ${store.token}` },
    });
    expectProblem(session, 401, accessProblemCodes.deviceRequired);
    for (const cursor of ["-1", "01", "abc", "1234567890123456"]) {
      const response = await server.inject({
        method: "GET",
        url: `/api/v1/sync/pull?cursor=${cursor}`,
        headers: { authorization: `Bearer ${device.credential}` },
      });
      expectProblem(response, 400, hostProblemCodes.invalidRequest);
    }
  });
});

describe("GET /api/v1/sales/invoices", () => {
  it("shows the owner each recorded sale, newest first, with its flags and balanced entry", async () => {
    const store = await newStore("متجر الفواتير");
    const device = await newDevice(store);
    const product = await newProduct(store, "12.5");
    const paid = sale(device, [{ productId: product.id, quantity: "2", unitPrice: "12.5" }]);
    const free = sale(device, [{ productId: product.id, quantity: "1", unitPrice: "0" }]);
    clock.advance(1_000);
    accepted((await push(device, [paid])).results[0]);
    clock.advance(1_000);
    accepted((await push(device, [free])).results[0]);

    const response = await invoicesOf(store);
    expect(response.statusCode, response.body).toBe(200);
    const { items } = response.json<{ items: unknown[] }>();
    expect(items).toEqual([
      expect.objectContaining({
        id: invoiceIdOf(free),
        number: `${device.prefix}-INV-000002`,
        total: { amount: "0", currency: "SYP" },
        flags: ["negativeStock"],
        journalEntry: null,
      }),
      {
        id: invoiceIdOf(paid),
        number: `${device.prefix}-INV-000001`,
        businessDate: "2026-09-25",
        soldAt: "2026-09-25T09:30:00.000Z",
        deviceId: device.deviceId,
        total: { amount: "25", currency: "SYP" },
        flags: ["negativeStock"],
        journalEntry: {
          id: expect.any(String) as string,
          accountingDate: "2026-09-25",
          currency: "SYP",
          lines: [
            {
              accountCode: "1100",
              accountName: expect.any(String) as string,
              debit: "25",
              credit: "0",
            },
            {
              accountCode: "4100",
              accountName: expect.any(String) as string,
              debit: "0",
              credit: "25",
            },
          ],
        },
      },
    ]);
  });

  it("shows a store only its own invoices, and nobody without a session", async () => {
    const other = await newStore("متجر له فاتورة");
    const device = await newDevice(other);
    const product = await newProduct(other, "3");
    accepted(
      (
        await push(device, [
          sale(device, [{ productId: product.id, quantity: "1", unitPrice: "3" }]),
        ])
      ).results[0],
    );
    expect((await invoicesOf(other)).json<{ items: unknown[] }>().items).toHaveLength(1);

    const store = await newStore("متجر بلا فواتير");
    const response = await invoicesOf(store);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
    expectProblem(await invoicesOf(null), 401, accessProblemCodes.sessionRequired);
  });

  it("are listed only with sales.invoices.view", async () => {
    const owner = await newStore("متجر الموظف");
    const staff = async (login: string, permissions: string[]): Promise<Store> => {
      await createStaffUser(tenants, owner.tenant, { login, permissions }, dependencies);
      return { tenant: owner.tenant, token: await signInAs(server, owner.tenant, login) };
    };
    const cashier = await staff("cashier", ["sales.invoice.create"]);
    expectProblem(await invoicesOf(cashier), 403, accessProblemCodes.permissionDenied);
    const accountant = await staff("accountant", ["sales.invoices.view"]);
    expect((await invoicesOf(accountant)).statusCode).toBe(200);
  });
});

describe("the database", () => {
  let store: Store;
  let invoiceId: string;
  let opId: string;
  let productId: string;
  let gapOpId: string;

  beforeAll(async () => {
    store = await newStore("متجر الثوابت");
    const device = await newDevice(store);
    const product = await newProduct(store);
    productId = product.id;
    const operation = sale(device, [{ productId, quantity: "4", unitPrice: "1250.50" }]);
    const result = accepted((await push(device, [operation])).results[0]);
    expect(result.flags).toEqual(["negativeStock"]);
    invoiceId = result.invoiceId;
    opId = operation.opId;
    // A second sale past a missing number: an operation flag and a document sequence.
    const gapped = sale(device, [{ productId, quantity: "1", unitPrice: "1" }], { invoiceSeq: 3 });
    accepted((await push(device, [gapped])).results[0]);
    gapOpId = gapped.opId;
  });

  const inStore = (statement: SQL) =>
    tenants.withTenant({ tenantId: store.tenant.tenantId }, (tx) => tx.execute(statement));

  async function refusal(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
    } catch (error) {
      return sqlState(error) ?? String(error);
    }
    return undefined;
  }

  // Built when the test runs: the ids exist only after `beforeAll`.
  const statements: Record<string, () => SQL> = {
    "update an invoice": () =>
      sql`update sales.invoices set total = total * 2 where id = ${invoiceId}`,
    "delete an invoice": () => sql`delete from sales.invoices where id = ${invoiceId}`,
    "update a line": () =>
      sql`update sales.invoice_lines set amount = 0 where invoice_id = ${invoiceId}`,
    "delete a line": () => sql`delete from sales.invoice_lines where invoice_id = ${invoiceId}`,
    "delete a flag": () => sql`delete from sales.invoice_flags where invoice_id = ${invoiceId}`,
    "update a received operation": () =>
      sql`update core_sync.received_ops set status = 'rejected' where id = ${opId}`,
    "delete a received operation": () => sql`delete from core_sync.received_ops where id = ${opId}`,
    "delete a change": () => sql`delete from core_sync.changes where entity_id = ${productId}`,
    "update an operation flag": () =>
      sql`update core_sync.operation_flags set code = 'deviceRevoked' where op_id = ${gapOpId}`,
    "delete an operation flag": () =>
      sql`delete from core_sync.operation_flags where op_id = ${gapOpId}`,
    "delete a document sequence": () => sql`delete from core_organization.document_sequences`,
    "move a document sequence to another device": () =>
      sql`update core_organization.document_sequences set device_id = device_id`,
    "update a stock movement": () =>
      sql`update inventory.stock_movements set quantity = 1 where source_id = ${invoiceId}`,
    "delete a stock movement": () =>
      sql`delete from inventory.stock_movements where source_id = ${invoiceId}`,
  };

  it.each(Object.keys(statements))("refuses the app role: %s", async (name) => {
    const statement = statements[name];
    if (statement === undefined) throw new Error(name);
    expect(await refusal(inStore(statement()))).toBe("42501");
  });

  it.each([
    "update sales.invoices set total = 0 where id = $1",
    "delete from sales.invoice_lines where invoice_id = $1",
    "update sales.invoice_flags set code = 'arithmeticMismatch' where invoice_id = $1",
    "delete from core_sync.received_ops where id = (select op_id from sales.invoices where id = $1)",
    "delete from inventory.stock_movements where source_id = $1",
    "delete from core_sync.operation_flags where tenant_id = (select tenant_id from sales.invoices where id = $1)",
  ])("refuses even a superuser: %s", async (statement) => {
    expect(await refusal(superuser.query(statement, [invoiceId]))).toBe("42501");
  });

  it("never moves a device's document sequence back", async () => {
    const statement = sql`update core_organization.document_sequences set last_seq = 1`;
    expect(await refusal(inStore(statement))).toBe("23514");
  });

  it("refuses, at commit, a flag on an operation the server never received", async () => {
    const { tenantId, branchId, ownerId } = store.tenant;
    const code = await refusal(
      inStore(sql`
        insert into core_sync.operation_flags
          (id, tenant_id, branch_id, created_at, created_by, op_id, code, detail)
        values (${newId()}, ${tenantId}, ${branchId}, now(), ${ownerId}, ${newId()}, 'numberGap', '{}')`),
    );
    expect(code).toBe("23503");
  });

  it("refuses an invoice naming another store's department", async () => {
    const rival = await newStore("متجر الأقسام الأخرى");
    const { tenantId, branchId, ownerId } = store.tenant;
    const { rows } = await superuser.query<{ device_id: string }>(
      "select device_id from sales.invoices where id = $1",
      [invoiceId],
    );
    const code = await refusal(
      inStore(sql`
        insert into sales.invoices
          (id, tenant_id, branch_id, created_at, created_by, number, device_id, doc_seq, op_id,
           business_date, sold_at, currency, exchange_rate, department_id, shift_id,
           template_version, total)
        values (${newId()}, ${tenantId}, ${branchId}, now(), ${ownerId}, 'ZZ-INV-999999',
                ${rows[0]?.device_id}, 999999, ${newId()}, '2026-09-25', now(), 'SYP', 1,
                ${rival.tenant.defaultDepartmentId}, ${newId()}, 'receipt.cash.2', 1)`),
    );
    expect(code).toBe("23503");
  });

  it("refuses a line appended to a posted invoice", async () => {
    const { tenantId, branchId, ownerId } = store.tenant;
    const code = await refusal(
      inStore(sql`
        insert into sales.invoice_lines
          (id, tenant_id, branch_id, created_at, created_by, invoice_id, line_no, product_id, quantity, unit_price, amount)
        values (${newId()}, ${tenantId}, ${branchId}, now(), ${ownerId}, ${invoiceId}, 2, ${productId}, 1, 1, 1)`),
    );
    expect(code).toBe("42501");
  });
});
