import { syncLocalMigrations } from "@mustawfi/core-sync/client";
import { CLOCK_TOLERANCE_MS, tenancyLocalMigrations } from "@mustawfi/core-tenancy/client";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { type LocalDb, migrateLocalDb } from "@mustawfi/local-db";
import { openNodeLocalDb } from "@mustawfi/local-db/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CURRENCY_SETTINGS_ENTITY,
  EXCHANGE_RATE_ENTITY,
  type ExchangeRateWire,
  RATE_SET_OPERATION,
  TENANT_CURRENCY_ENTITY,
} from "../shared/index.ts";
import {
  currencyLocalMigrations,
  currencyPullAppliers,
  type DeviceRateInput,
  DeviceRateRefused,
  listLocalCurrentRates,
  listLocalExchangeRates,
  listLocalTenantCurrencies,
  localCurrencySettingsOf,
  setDeviceExchangeRate,
} from "./local-currency.ts";

const clock = manualClock(new Date("2026-09-28T09:00:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const DEVICE = { deviceId: "0190a000-0000-7000-8000-00000000d001", baseCurrency: "SYP" };
const OWNER = "0190a000-0000-7000-8000-00000000a001";
const SHIFT = "0190a000-0000-7000-8000-00000000c001";

let db: LocalDb;

beforeEach(async () => {
  db = openNodeLocalDb(":memory:");
  await migrateLocalDb(db, [
    ...syncLocalMigrations,
    ...tenancyLocalMigrations,
    ...currencyLocalMigrations,
  ]);
});

afterEach(async () => {
  await db.close();
});

/** Applies pulled changes as the sync engine does: in one local transaction. */
async function pull(
  changes: readonly { entity: string; id: string; row: Record<string, unknown> | null }[],
): Promise<void> {
  const appliers = new Map(currencyPullAppliers.map((applier) => [applier.entity, applier]));
  await db.transaction(async (tx) => {
    for (const change of changes) await appliers.get(change.entity)?.apply(tx, change);
  });
}

/** The store's currencies and settings as a new SYP-base tenant is seeded. */
async function pullSeed(): Promise<void> {
  await pull([
    ...[
      { code: "SYP", strengthRank: 3, enabled: true, cashRoundingStep: "10.00" },
      { code: "USD", strengthRank: 1, enabled: true, cashRoundingStep: "0.01" },
      { code: "TRY", strengthRank: 2, enabled: false, cashRoundingStep: "1.00" },
    ].map((currency) => ({
      entity: TENANT_CURRENCY_ENTITY,
      id: newId(),
      row: { ...currency, minorUnits: 2 },
    })),
    {
      entity: CURRENCY_SETTINGS_ENTITY,
      id: newId(),
      row: { changeCurrency: "SYP", rateChangeThresholdPercent: 10 },
    },
  ]);
}

function serverRate(values: Partial<ExchangeRateWire> & Pick<ExchangeRateWire, "rate">) {
  return {
    id: newId(),
    unitCurrency: "USD",
    quoteCurrency: "SYP",
    effectiveAt: clock.now().toISOString(),
    recordedAt: clock.now().toISOString(),
    setBy: OWNER,
    deviceId: null,
    opId: null,
    ...values,
  } satisfies ExchangeRateWire;
}

const pullRate = (rate: ExchangeRateWire) =>
  pull([{ entity: EXCHANGE_RATE_ENTITY, id: rate.id, row: rate }]);

function input(values: Partial<DeviceRateInput> & Pick<DeviceRateInput, "rate">): DeviceRateInput {
  return {
    device: DEVICE,
    userId: OWNER,
    shiftId: SHIFT,
    unitCurrency: "USD",
    quoteCurrency: "SYP",
    confirmed: false,
    clock,
    newId,
    ...values,
  };
}

async function refusal(values: Parameters<typeof input>[0]): Promise<unknown> {
  try {
    await setDeviceExchangeRate(db, input(values));
  } catch (error) {
    if (error instanceof DeviceRateRefused) return { reason: error.reason, change: error.change };
    throw error;
  }
  return undefined;
}

async function outbox(): Promise<{ type: string; payload: unknown; created_at: string }[]> {
  const rows = await db.query(
    "SELECT type, payload, created_at FROM sync_outbox ORDER BY device_seq",
  );
  return rows.map((row) => ({
    type: row["type"] as string,
    payload: JSON.parse(row["payload"] as string) as unknown,
    created_at: row["created_at"] as string,
  }));
}

describe("pulled currencies, settings, and rates", () => {
  it("are what the server sent, with the current rate by the latest effective time, then id", async () => {
    await pullSeed();
    expect((await listLocalTenantCurrencies(db)).map((c) => [c.code, c.enabled])).toEqual([
      ["SYP", true],
      ["USD", true],
      ["TRY", false],
    ]);
    expect(await localCurrencySettingsOf(db)).toEqual({
      changeCurrency: "SYP",
      rateChangeThresholdPercent: 10,
    });
    const morning = serverRate({ rate: "122", effectiveAt: "2026-09-28T07:00:00.000Z" });
    const noon = serverRate({ rate: "124.5", effectiveAt: "2026-09-28T09:00:00.000Z" });
    const tie = serverRate({ rate: "124", effectiveAt: "2026-09-28T09:00:00.000Z" });
    // A late rate, pulled after the current one, is history.
    await pullRate(noon);
    await pullRate(tie);
    await pullRate(morning);
    const [current] = await listLocalCurrentRates(db);
    expect(current).toEqual({ ...tie, rate: "124" });
    expect((await listLocalExchangeRates(db)).map((rate) => rate.rate)).toEqual([
      "124",
      "124.5",
      "122",
    ]);
  });

  it("guard a mistyped rate with the default threshold before the settings arrive", async () => {
    await pullSeed();
    await db.query("DELETE FROM currency_settings");
    await pullRate(serverRate({ rate: "122" }));
    expect(await refusal({ rate: "12200" })).toMatchObject({ reason: "confirmationRequired" });
  });

  it("hold the highest rate the server accepts, exactly", async () => {
    const highest = serverRate({ rate: "999999999999.999999" });
    await pullRate(highest);
    expect(await listLocalCurrentRates(db)).toEqual([highest]);
  });
});

describe("setting a rate on the device (rules 6, 9, 11)", () => {
  beforeEach(pullSeed);

  it("applies at once and queues its operation in the same transaction", async () => {
    await pullRate(serverRate({ rate: "122", effectiveAt: "2026-09-28T07:00:00.000Z" }));
    clock.advance(60_000);
    const set = await setDeviceExchangeRate(db, input({ rate: "121.50" }));
    expect(set).toEqual({
      id: set.id,
      unitCurrency: "USD",
      quoteCurrency: "SYP",
      rate: "121.5",
      effectiveAt: clock.now().toISOString(),
      recordedAt: null,
      setBy: OWNER,
      deviceId: DEVICE.deviceId,
      opId: set.opId,
    });
    expect(await listLocalCurrentRates(db)).toEqual([set]);
    expect(await outbox()).toEqual([
      {
        type: RATE_SET_OPERATION,
        payload: {
          rateId: set.id,
          unitCurrency: "USD",
          quoteCurrency: "SYP",
          rate: "121.5",
          effectiveAt: set.effectiveAt,
          confirmed: false,
        },
        created_at: set.effectiveAt,
      },
    ]);
  });

  it("takes the server's copy when it is pulled back", async () => {
    const set = await setDeviceExchangeRate(db, input({ rate: "125" }));
    clock.advance(5 * 60_000);
    const recorded = serverRate({
      id: set.id,
      rate: "125",
      effectiveAt: set.effectiveAt,
      deviceId: DEVICE.deviceId,
      opId: set.opId,
    });
    await pullRate(recorded);
    expect(await listLocalCurrentRates(db)).toEqual([recorded]);
    expect(await listLocalExchangeRates(db)).toHaveLength(1);
  });

  it.each([
    ["an inverted pair", { unitCurrency: "SYP", quoteCurrency: "USD", rate: "0.008" }, "inverted"],
    ["a pair without the base", { quoteCurrency: "TRY", rate: "41" }, "withoutBase"],
    ["a disabled currency", { unitCurrency: "TRY", rate: "3" }, "disabled"],
    ["a zero rate", { rate: "0" }, "rateInvalid"],
    ["13 whole digits", { rate: "1000000000000" }, "rateInvalid"],
    ["7 decimals", { rate: "1.1234567" }, "rateInvalid"],
  ] as const)("refuses %s, writing nothing", async (_, values, reason) => {
    expect(await refusal(values)).toEqual({ reason, change: undefined });
    expect(await listLocalExchangeRates(db)).toEqual([]);
    expect(await outbox()).toEqual([]);
  });

  it("asks for confirmation beyond the threshold, with the change, and sets it once confirmed", async () => {
    const current = serverRate({ rate: "122" });
    await pullRate(current);
    clock.advance(60_000);
    expect(await refusal({ rate: "12200" })).toEqual({
      reason: "confirmationRequired",
      change: { current, percent: "9900" },
    });
    expect(await refusal({ rate: "109.79" })).toMatchObject({
      reason: "confirmationRequired",
      change: { percent: "-10.01" },
    });
    expect(await outbox()).toEqual([]);
    // Within the threshold, no confirmation; beyond it, confirmed.
    expect(await refusal({ rate: "134.2" })).toBeUndefined();
    const confirmed = await setDeviceExchangeRate(db, input({ rate: "12200", confirmed: true }));
    expect((await listLocalCurrentRates(db))[0]?.rate).toBe("12200");
    expect((await outbox()).map((op) => (op.payload as { confirmed: boolean }).confirmed)).toEqual([
      false,
      true,
    ]);
    expect(confirmed.rate).toBe("12200");
  });

  it("dates it by the guarded clock: a clock moved back does not date a rate back", async () => {
    const first = await setDeviceExchangeRate(db, input({ rate: "122" }));
    clock.advance(-(CLOCK_TOLERANCE_MS + 60 * 60_000));
    const second = await setDeviceExchangeRate(db, input({ rate: "123" }));
    expect(Date.parse(second.effectiveAt)).toBeGreaterThanOrEqual(Date.parse(first.effectiveAt));
    // The later rate is the current one, as it was set later.
    expect((await listLocalCurrentRates(db))[0]?.id).toBe(second.id);
  });
});
