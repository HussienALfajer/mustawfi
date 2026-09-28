import { accessProblemCodes } from "@mustawfi/core-access/shared";
import { hostProblemCodes, problemDetailsSchema } from "@mustawfi/core-config/shared";
import {
  currencyProblemCodes,
  currencySettingsSchema,
  EXCHANGE_RATE_ENTITY,
  exchangeRateSchema,
  type ExchangeRateWire,
  RATE_SET_OPERATION,
  type RateSetPayloadV1,
  TENANT_CURRENCY_ENTITY,
  tenantCurrencySchema,
} from "@mustawfi/core-currency/shared";
import type {
  OperationResult,
  PullResponse,
  PushResponse,
  SyncOperation,
} from "@mustawfi/core-sync/shared";
import { openTenantDatabase, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { SKELETON_DOCUMENT_DEFAULTS } from "@mustawfi/sales/shared";
import { createTestDatabase, type TestDatabase } from "@mustawfi/testing";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHostServer } from "./host-server.ts";
import { applyMigrations } from "./db/migrate.ts";
import { migrationSets } from "./db/migration-sets.ts";
import { createServerRegistry } from "./modules.ts";
import { createStaffUser, signInAs, type StaffUser } from "./staff.test-helpers.ts";
import type { CreatedTenant } from "./tenants/create-tenant.ts";
import { createLicensedTenant } from "./tenants/licensed-tenant.test-helpers.ts";
import { testBundleKey } from "./bundle-key.test-helpers.ts";
import { testTotpKeys } from "./totp-keys.test-helpers.ts";

/**
 * Setting exchange rates online and on devices (`core-money` slice 2, rules 6–11), and every
 * device receiving the store's currencies, settings, and rates through pull.
 */

const PASSWORD = "correct horse battery staple";
const clock = manualClock(new Date("2026-09-28T08:00:00.000Z"));
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
  seq: number;
}

beforeAll(async () => {
  database = await createTestDatabase("currency_rates");
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

async function newStore(name: string, baseCurrency: "SYP" | "USD" = "SYP"): Promise<Store> {
  const tenant = await createLicensedTenant(
    tenants,
    { name, baseCurrency, ownerName: "أحمد", ownerLogin: "ahmad", ownerPassword: PASSWORD },
    dependencies,
    { limits: { mainPosDevices: 20 } },
  );
  return { tenant, token: await signInAs(server, tenant, "ahmad", PASSWORD) };
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

function setRate(token: string | null, body: Record<string, unknown>) {
  return server.inject({
    method: "POST",
    url: "/api/v1/currency/rates",
    payload: body,
    ...(token === null ? {} : { headers: { authorization: `Bearer ${token}` } }),
  });
}

async function setRateOk(token: string, body: Record<string, unknown>): Promise<ExchangeRateWire> {
  const response = await setRate(token, body);
  expect(response.statusCode, response.body).toBe(201);
  return exchangeRateSchema.parse(response.json());
}

function expectProblem(
  response: { statusCode: number; json(): unknown },
  status: number,
  code: string,
) {
  expect(response.statusCode).toBe(status);
  expect(problemDetailsSchema.parse(response.json())).toMatchObject({ status, code });
}

/** The device's next `currency.rate.set` operation. */
function rateOperation(
  device: TestDevice,
  payload: Partial<RateSetPayloadV1> & Pick<RateSetPayloadV1, "rate" | "effectiveAt">,
  envelope: Partial<SyncOperation> = {},
): SyncOperation {
  const deviceSeq = device.seq;
  device.seq += 1;
  return {
    opId: newId(),
    deviceId: device.deviceId,
    deviceSeq,
    type: RATE_SET_OPERATION,
    payloadVersion: 1,
    payload: {
      rateId: newId(),
      unitCurrency: "USD",
      quoteCurrency: "SYP",
      confirmed: false,
      ...payload,
    },
    userId: device.store.tenant.ownerId,
    shiftId: SKELETON_DOCUMENT_DEFAULTS.shiftId,
    createdAt: clock.now().toISOString(),
    ...envelope,
  };
}

async function push(device: TestDevice, operations: readonly SyncOperation[]) {
  const response = await server.inject({
    method: "POST",
    url: "/api/v1/sync/push",
    payload: { operations },
    headers: { authorization: `Bearer ${device.credential}` },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<PushResponse>();
}

async function pullAll(device: TestDevice): Promise<PullResponse["changes"]> {
  const changes: PullResponse["changes"] = [];
  let cursor = "0";
  for (;;) {
    const response = await server.inject({
      method: "GET",
      url: `/api/v1/sync/pull?cursor=${cursor}`,
      headers: { authorization: `Bearer ${device.credential}` },
    });
    expect(response.statusCode, response.body).toBe(200);
    const page = response.json<PullResponse>();
    changes.push(...page.changes);
    cursor = page.cursor;
    if (!page.more) return changes;
  }
}

function acceptedResult(result: OperationResult | undefined) {
  expect(result?.status, JSON.stringify(result)).toBe("accepted");
  return (result as Extract<OperationResult, { status: "accepted" }>).result as {
    rate: ExchangeRateWire;
    current: boolean;
  };
}

function rejectedCode(result: OperationResult | undefined): string | undefined {
  expect(result?.status, JSON.stringify(result)).toBe("rejected");
  return (result as Extract<OperationResult, { status: "rejected" }>).code;
}

async function currentRate(store: Store, unit = "USD", quote = "SYP"): Promise<string | undefined> {
  const { rows } = await superuser.query<{ rate: string }>(
    `select rate::text as rate from core_currency.exchange_rates
     where tenant_id = $1 and unit_currency = $2 and quote_currency = $3
     order by effective_at desc, id desc limit 1`,
    [store.tenant.tenantId, unit, quote],
  );
  return rows[0]?.rate;
}

async function auditOf(rateId: string) {
  const { rows } = await superuser.query<{
    created_by: string;
    device_id: string | null;
    before: unknown;
    after: Record<string, unknown>;
  }>(
    "select created_by, device_id, before, after from core_audit.entries where action = 'currency.rate.set' and entity_id = $1",
    [rateId],
  );
  return rows;
}

async function flagsOf(opId: string): Promise<string[]> {
  const { rows } = await superuser.query<{ code: string }>(
    "select code from core_sync.operation_flags where op_id = $1 order by code",
    [opId],
  );
  return rows.map((row) => row.code);
}

describe("POST /api/v1/currency/rates (rules 6–11)", () => {
  let store: Store;

  beforeAll(async () => {
    store = await newStore("متجر النور");
  });

  it("sets the first rate at the server's time, audited and published for devices", async () => {
    const rate = await setRateOk(store.token, {
      unitCurrency: "USD",
      quoteCurrency: "SYP",
      rate: "122.50",
    });
    expect(rate).toEqual({
      id: rate.id,
      unitCurrency: "USD",
      quoteCurrency: "SYP",
      rate: "122.5",
      effectiveAt: clock.now().toISOString(),
      recordedAt: clock.now().toISOString(),
      setBy: store.tenant.ownerId,
      deviceId: null,
      opId: null,
    });
    expect(await auditOf(rate.id)).toEqual([
      {
        created_by: store.tenant.ownerId,
        device_id: null,
        before: null,
        after: {
          unitCurrency: "USD",
          quoteCurrency: "SYP",
          rate: "122.5",
          effectiveAt: rate.effectiveAt,
          confirmed: false,
          current: true,
        },
      },
    ]);
    const { rows } = await superuser.query(
      "select row from core_sync.changes where tenant_id = $1 and entity = $2 and entity_id = $3",
      [store.tenant.tenantId, EXCHANGE_RATE_ENTITY, rate.id],
    );
    expect(rows).toEqual([{ row: rate }]);
  });

  it("needs currency.rate.set: 401 without a session, 403 without the permission", async () => {
    const viewer = await createStaffUser(
      tenants,
      store.tenant,
      { login: "viewer", permissions: ["inventory.products.view"] },
      dependencies,
    );
    const body = { unitCurrency: "USD", quoteCurrency: "SYP", rate: "123" };
    expectProblem(await setRate(null, body), 401, accessProblemCodes.sessionRequired);
    expectProblem(
      await setRate(await signInAs(server, store.tenant, viewer.login), body),
      403,
      accessProblemCodes.permissionDenied,
    );
    const accountant = await createStaffUser(
      tenants,
      store.tenant,
      { login: "accountant", permissions: ["currency.rate.set"] },
      dependencies,
    );
    clock.advance(60_000);
    const rate = await setRateOk(await signInAs(server, store.tenant, accountant.login), body);
    expect(rate.setBy).toBe(accountant.userId);
  });

  it.each([
    ["zero", { rate: "0" }],
    ["negative", { rate: "-5" }],
    ["13 whole digits", { rate: "1000000000000" }],
    ["7 decimals", { rate: "123.1234567" }],
    ["not a number", { rate: "١٢٢" }],
    ["a currency outside the catalog", { unitCurrency: "EUR" }],
    ["an unknown field", { note: "من الصرّاف" }],
  ])("refuses %s (400)", async (_, change) => {
    const response = await setRate(store.token, {
      unitCurrency: "USD",
      quoteCurrency: "SYP",
      rate: "123",
      ...change,
    });
    expectProblem(response, 400, hostProblemCodes.invalidRequest);
  });

  it("holds the highest rate a device can: 12 whole digits and 6 decimals", async () => {
    const dollarStore = await newStore("متجر الحدود", "USD");
    const rate = await setRateOk(dollarStore.token, {
      unitCurrency: "USD",
      quoteCurrency: "SYP",
      rate: "999999999999.999999",
    });
    expect(rate.rate).toBe("999999999999.999999");
  });

  it.each([
    ["inverted", { unitCurrency: "SYP", quoteCurrency: "USD", rate: "0.008" }],
    ["without the base", { unitCurrency: "USD", quoteCurrency: "TRY", rate: "41" }],
    ["a disabled currency", { unitCurrency: "TRY", quoteCurrency: "SYP", rate: "3" }],
    ["one currency twice", { unitCurrency: "USD", quoteCurrency: "USD", rate: "1" }],
  ])("refuses a pair %s (422)", async (_, body) => {
    expectProblem(await setRate(store.token, body), 422, currencyProblemCodes.invalidPair);
  });

  it("quotes SYP against a USD base as SYP per 1 USD, and refuses a pair of two foreign currencies", async () => {
    const dollarStore = await newStore("متجر الشمال", "USD");
    await setRateOk(dollarStore.token, { unitCurrency: "USD", quoteCurrency: "SYP", rate: "120" });
    await superuser.query(
      "update core_currency.tenant_currencies set enabled = true where tenant_id = $1 and code = 'TRY'",
      [dollarStore.tenant.tenantId],
    );
    await setRateOk(dollarStore.token, { unitCurrency: "USD", quoteCurrency: "TRY", rate: "41" });
    expectProblem(
      await setRate(dollarStore.token, { unitCurrency: "TRY", quoteCurrency: "SYP", rate: "3" }),
      422,
      currencyProblemCodes.invalidPair,
    );
  });

  it("asks for confirmation beyond the threshold, either way, and records it", async () => {
    const shop = await newStore("متجر التأكيد");
    const set = (rate: string, confirmed?: boolean) =>
      setRate(shop.token, {
        unitCurrency: "USD",
        quoteCurrency: "SYP",
        rate,
        ...(confirmed === undefined ? {} : { confirmed }),
      });
    clock.advance(60_000);
    expect((await set("100")).statusCode).toBe(201);
    // Exactly 10% is within the threshold; a millionth more is not.
    clock.advance(60_000);
    expect((await set("110")).statusCode).toBe(201);
    clock.advance(60_000);
    expectProblem(await set("121.000001"), 422, currencyProblemCodes.confirmationRequired);
    expectProblem(await set("98.999999"), 422, currencyProblemCodes.confirmationRequired);
    expect(await currentRate(shop)).toBe("110.000000");
    // The owner who typed old pounds (edge case): confirmed anyway, it applies.
    const confirmed = await set("11000", true);
    expect(confirmed.statusCode).toBe(201);
    const rate = exchangeRateSchema.parse(confirmed.json());
    const [audit] = await auditOf(rate.id);
    expect(audit?.before).toMatchObject({ rate: "110" });
    expect(audit?.after).toMatchObject({ rate: "11000", confirmed: true, current: true });
    expect(await currentRate(shop)).toBe("11000.000000");
  });
});

describe("the currency.rate.set operation (rules 8–11)", () => {
  let store: Store;
  let device: TestDevice;

  beforeAll(async () => {
    store = await newStore("متجر الأجهزة");
    device = await newDevice(store);
  });

  it("records a rate set offline with its device, operation, and device time; a resend is a duplicate", async () => {
    const setAt = new Date(clock.now().getTime() - 30 * 60_000).toISOString();
    const operation = rateOperation(device, { rate: "125", effectiveAt: setAt });
    clock.advance(1_000);
    const first = await push(device, [operation]);
    const result = acceptedResult(first.results[0]);
    expect(result).toEqual({
      rate: {
        id: (operation.payload as RateSetPayloadV1).rateId,
        unitCurrency: "USD",
        quoteCurrency: "SYP",
        rate: "125",
        effectiveAt: setAt,
        recordedAt: clock.now().toISOString(),
        setBy: store.tenant.ownerId,
        deviceId: device.deviceId,
        opId: operation.opId,
      },
      current: true,
    });
    expect(await auditOf(result.rate.id)).toEqual([
      {
        created_by: store.tenant.ownerId,
        device_id: device.deviceId,
        before: null,
        after: {
          unitCurrency: "USD",
          quoteCurrency: "SYP",
          rate: "125",
          effectiveAt: setAt,
          confirmed: false,
          current: true,
        },
      },
    ]);

    const again = await push(device, [operation]);
    expect(again.results[0]).toMatchObject({ status: "duplicate", result });
    const { rows } = await superuser.query(
      "select count(*)::int as n from core_currency.exchange_rates where id = $1",
      [result.rate.id],
    );
    expect(rows).toEqual([{ n: 1 }]);
  });

  it("stores a rate older than the current one as history, changing nothing current", async () => {
    const older = rateOperation(device, {
      rate: "126",
      effectiveAt: new Date(clock.now().getTime() - 60 * 60_000).toISOString(),
    });
    const result = acceptedResult((await push(device, [older])).results[0]);
    expect(result.current).toBe(false);
    expect(await currentRate(store)).toBe("125.000000");
    expect((await auditOf(result.rate.id))[0]?.after).toMatchObject({ current: false });
  });

  it("is never refused for its confirmation, nor for a currency disabled since", async () => {
    const at = clock.now().toISOString();
    const jump = rateOperation(device, { rate: "12500", effectiveAt: at });
    const lira = rateOperation(device, {
      unitCurrency: "TRY",
      quoteCurrency: "SYP",
      rate: "3.1",
      effectiveAt: at,
      confirmed: true,
    });
    const pushed = await push(device, [jump, lira]);
    expect(acceptedResult(pushed.results[0]).current).toBe(true);
    expect(acceptedResult(pushed.results[1]).current).toBe(true);
    expect(await currentRate(store)).toBe("12500.000000");
    expect(await currentRate(store, "TRY")).toBe("3.100000");
  });

  it("takes a device time ahead of the server's receipt as the receipt, auditing the device's", async () => {
    clock.advance(60_000);
    const ahead = new Date(clock.now().getTime() + 15 * 60_000).toISOString();
    const operation = rateOperation(device, { rate: "124", effectiveAt: ahead, confirmed: true });
    const result = acceptedResult((await push(device, [operation])).results[0]);
    expect(result.rate.effectiveAt).toBe(clock.now().toISOString());
    expect((await auditOf(result.rate.id))[0]?.after).toMatchObject({
      effectiveAt: clock.now().toISOString(),
      deviceEffectiveAt: ahead,
    });
  });

  it("flags a rate set by a user without the permission, and records it", async () => {
    const cashier: StaffUser = await createStaffUser(
      tenants,
      store.tenant,
      { login: "cashier", permissions: ["sales.invoice.create"] },
      dependencies,
    );
    clock.advance(60_000);
    const operation = rateOperation(
      device,
      { rate: "123", effectiveAt: clock.now().toISOString() },
      { userId: cashier.userId },
    );
    const result = acceptedResult((await push(device, [operation])).results[0]);
    expect(result.rate.setBy).toBe(cashier.userId);
    expect(await flagsOf(operation.opId)).toEqual(["permissionMissing"]);
    expect(await currentRate(store)).toBe("123.000000");
  });

  it.each([
    ["a zero rate", { rate: "0" }, currencyProblemCodes.rateInvalid],
    ["a rate beyond a device", { rate: "1000000000000" }, currencyProblemCodes.rateInvalid],
    ["no effective time", { effectiveAt: "yesterday" }, currencyProblemCodes.rateInvalid],
    [
      "an inverted pair",
      { unitCurrency: "SYP", quoteCurrency: "USD", rate: "0.008" },
      currencyProblemCodes.invalidPair,
    ],
    [
      "a pair without the base",
      { unitCurrency: "USD", quoteCurrency: "TRY", rate: "41" },
      currencyProblemCodes.invalidPair,
    ],
  ])("rejects %s, keeping the rejection for resends", async (_, change, code) => {
    const operation = rateOperation(device, {
      rate: "123",
      effectiveAt: clock.now().toISOString(),
      ...change,
    } as RateSetPayloadV1);
    expect(rejectedCode((await push(device, [operation])).results[0])).toBe(code);
    expect(rejectedCode((await push(device, [operation])).results[0])).toBe(code);
  });

  it("rejects another operation carrying a recorded rate's id", async () => {
    const first = rateOperation(device, { rate: "123", effectiveAt: clock.now().toISOString() });
    acceptedResult((await push(device, [first])).results[0]);
    const copy = rateOperation(device, {
      rateId: (first.payload as RateSetPayloadV1).rateId,
      rate: "130",
      effectiveAt: clock.now().toISOString(),
    });
    expect(rejectedCode((await push(device, [copy])).results[0])).toBe(
      currencyProblemCodes.rateDuplicate,
    );
  });
});

describe("pull (core-money: offline and sync behavior)", () => {
  it("gives a new device the store's currencies, settings, and every rate, from the start", async () => {
    const store = await newStore("متجر السحب");
    clock.advance(60_000);
    const first = await setRateOk(store.token, {
      unitCurrency: "USD",
      quoteCurrency: "SYP",
      rate: "122",
    });
    clock.advance(60_000);
    const second = await setRateOk(store.token, {
      unitCurrency: "USD",
      quoteCurrency: "SYP",
      rate: "121",
    });
    const device = await newDevice(store);
    const changes = await pullAll(device);
    const currencies = changes
      .filter((change) => change.entity === TENANT_CURRENCY_ENTITY)
      .map((change) => tenantCurrencySchema.parse(change.row));
    expect(currencies).toEqual([
      { code: "SYP", minorUnits: 2, strengthRank: 3, enabled: true, cashRoundingStep: "10.00" },
      { code: "USD", minorUnits: 2, strengthRank: 1, enabled: true, cashRoundingStep: "0.01" },
      { code: "TRY", minorUnits: 2, strengthRank: 2, enabled: false, cashRoundingStep: "1.00" },
    ]);
    expect(
      changes
        .filter((change) => change.entity === "currency.settings")
        .map((change) => currencySettingsSchema.parse(change.row)),
    ).toEqual([{ changeCurrency: "SYP", rateChangeThresholdPercent: 10 }]);
    expect(
      changes
        .filter((change) => change.entity === EXCHANGE_RATE_ENTITY)
        .map((change) => exchangeRateSchema.parse(change.row)),
    ).toEqual([first, second]);
  });
});
