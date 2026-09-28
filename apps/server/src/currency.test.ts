import {
  appendExchangeRate,
  currentExchangeRates,
  type ExchangeRateRecord,
  listExchangeRates,
  listTenantCurrencies,
  readCurrencySettings,
} from "@mustawfi/core-currency/server";
import {
  openTenantDatabase,
  type TenantDatabase,
  type TenantTransaction,
} from "@mustawfi/core-tenancy/server";
import { cryptoRandom, Decimal, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { createTestDatabase, sqlState, type TestDatabase } from "@mustawfi/testing";
import { sql } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./db/migrate.ts";
import { migrationSets } from "./db/migration-sets.ts";
import type { CreatedTenant } from "./tenants/create-tenant.ts";
import { createLicensedTenant } from "./tenants/licensed-tenant.test-helpers.ts";

const clock = manualClock(new Date("2026-09-28T08:00:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const dependencies = { clock, newId, random: cryptoRandom };

let database: TestDatabase;
let tenants: TenantDatabase;
let superuser: pg.Client;
/** Base SYP. */
let store: CreatedTenant;
/** Base USD. */
let dollarStore: CreatedTenant;

function newTenant(name: string, baseCurrency: "SYP" | "USD"): Promise<CreatedTenant> {
  return createLicensedTenant(
    tenants,
    {
      name,
      baseCurrency,
      ownerName: "أحمد",
      ownerLogin: "ahmad",
      ownerPassword: "correct horse battery staple",
    },
    dependencies,
  );
}

const inTenant = <T>(tenant: CreatedTenant, fn: (tx: TenantTransaction) => Promise<T>) =>
  tenants.withTenant({ tenantId: tenant.tenantId, userId: tenant.ownerId }, fn);

async function refusal(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RangeError) return "RangeError";
    return sqlState(error) ?? String(error);
  }
  return undefined;
}

/** A rate of `tenant` set online at `effectiveAt`, recorded now. */
function rate(
  tenant: CreatedTenant,
  values: Pick<ExchangeRateRecord, "unitCurrency" | "quoteCurrency"> & {
    readonly rate: string;
    readonly effectiveAt: string;
    readonly id?: string;
  },
): ExchangeRateRecord {
  return {
    id: values.id ?? newId(),
    tenantId: tenant.tenantId,
    branchId: tenant.branchId,
    unitCurrency: values.unitCurrency,
    quoteCurrency: values.quoteCurrency,
    rate: Decimal.of(values.rate),
    effectiveAt: new Date(values.effectiveAt),
    recordedAt: clock.now(),
    setBy: tenant.ownerId,
  };
}

const append = (tenant: CreatedTenant, record: ExchangeRateRecord) =>
  inTenant(tenant, (tx) => appendExchangeRate(tx, record));

beforeAll(async () => {
  database = await createTestDatabase("currency");
  await applyMigrations(database.url("owner"), migrationSets);
  tenants = await openTenantDatabase({ connectionString: database.url("app") });
  superuser = await database.connect("superuser");
  store = await newTenant("متجر النور", "SYP");
  dollarStore = await newTenant("متجر الشمال", "USD");
});

afterAll(async () => {
  await superuser.end();
  await tenants.close();
});

describe("a new tenant's currencies (rules 1–5)", () => {
  it("are seeded by its base: SYP and USD enabled, TRY off, with the default steps", async () => {
    const expected = [
      { code: "SYP", minorUnits: 2, strengthRank: 3, enabled: true, cashRoundingStep: "10.00" },
      { code: "USD", minorUnits: 2, strengthRank: 1, enabled: true, cashRoundingStep: "0.01" },
      { code: "TRY", minorUnits: 2, strengthRank: 2, enabled: false, cashRoundingStep: "1.00" },
    ];
    expect(await inTenant(store, listTenantCurrencies)).toEqual(expected);
    expect(await inTenant(dollarStore, listTenantCurrencies)).toEqual(expected);
  });

  it("give change in SYP and confirm a rate that moves more than 10%", async () => {
    for (const tenant of [store, dollarStore]) {
      expect(await inTenant(tenant, readCurrencySettings)).toEqual({
        changeCurrency: "SYP",
        rateChangeThresholdPercent: 10,
      });
    }
  });

  it("record who seeded them, in the tenant's branch", async () => {
    const { rows } = await superuser.query(
      `select distinct branch_id, created_by from core_currency.tenant_currencies where tenant_id = $1
       union all
       select branch_id, created_by from core_currency.currency_settings where tenant_id = $1`,
      [store.tenantId],
    );
    expect(rows).toEqual([
      { branch_id: store.branchId, created_by: store.ownerId },
      { branch_id: store.branchId, created_by: store.ownerId },
    ]);
  });

  describe("are refused by the database when they break the catalog", () => {
    const update = (set: string) =>
      refusal(inTenant(store, (tx) => tx.execute(sql.raw(`update core_currency.${set}`))));

    it.each([
      ["a step of zero", "tenant_currencies set cash_rounding_step = 0 where code = 'SYP'"],
      [
        "a step above 1000",
        "tenant_currencies set cash_rounding_step = 1000.01 where code = 'SYP'",
      ],
      ["a step finer than the minor unit", "tenant_currencies set cash_rounding_step = 0.005"],
      ["a threshold of 0", "currency_settings set rate_change_threshold_percent = 0"],
      ["a threshold above 100", "currency_settings set rate_change_threshold_percent = 101"],
    ])("%s (check)", async (_, set) => {
      expect(await update(set)).toBe("23514");
    });

    it("a change currency the tenant does not have (foreign key)", async () => {
      expect(await update("currency_settings set change_currency = 'EUR'")).toBe("23503");
    });

    it("a currency outside the catalog, and a code change (grants)", async () => {
      expect(
        await refusal(
          inTenant(store, (tx) =>
            tx.execute(sql`
              insert into core_currency.tenant_currencies
                (id, tenant_id, branch_id, created_at, created_by, code, enabled, cash_rounding_step, updated_at, updated_by)
              values (${newId()}, ${store.tenantId}, ${store.branchId}, now(), ${store.ownerId},
                'EUR', true, 0.01, now(), ${store.ownerId})`),
          ),
        ),
      ).toBe("23514");
      expect(await update("tenant_currencies set code = 'EUR' where code = 'TRY'")).toBe("42501");
      expect(
        await refusal(
          inTenant(store, (tx) => tx.execute(sql`delete from core_currency.tenant_currencies`)),
        ),
      ).toBe("42501");
    });

    it("accepts a valid change the settings screen will make", async () => {
      expect(await update("tenant_currencies set cash_rounding_step = 25 where code = 'TRY'")).toBe(
        undefined,
      );
      expect(await update("tenant_currencies set cash_rounding_step = 1 where code = 'TRY'")).toBe(
        undefined,
      );
    });
  });
});

describe("exchange rates (rules 6–8)", () => {
  it("are quoted per 1 unit of the stronger currency; an inverted pair never reaches the table", async () => {
    // The kernel refuses before the insert; the database refuses a raw insert too.
    expect(
      await refusal(
        append(
          store,
          rate(store, {
            unitCurrency: "SYP",
            quoteCurrency: "USD",
            rate: "0.000077",
            effectiveAt: "2026-09-28T08:00:00Z",
          }),
        ),
      ),
    ).toBe("RangeError");
    const raw = (unit: string, quote: string, value: string) =>
      refusal(
        inTenant(store, (tx) =>
          tx.execute(sql`
            insert into core_currency.exchange_rates
              (id, tenant_id, branch_id, created_at, created_by, unit_currency, quote_currency, rate, effective_at)
            values (${newId()}, ${store.tenantId}, ${store.branchId}, now(), ${store.ownerId},
              ${unit}, ${quote}, ${value}, now())`),
        ),
      );
    expect(await raw("SYP", "USD", "0.000077")).toBe("23514");
    expect(await raw("SYP", "TRY", "0.003")).toBe("23514");
    expect(await raw("TRY", "USD", "0.02")).toBe("23514");
    expect(await raw("USD", "EUR", "0.9")).toBe("23514");
  });

  it("hold at most 12 whole digits, and are positive (rule 7)", async () => {
    const at = {
      unitCurrency: "USD",
      quoteCurrency: "SYP",
      effectiveAt: "2026-09-01T00:00:00Z",
    } as const;
    expect(await refusal(append(store, rate(store, { ...at, rate: "1000000000000" })))).toBe(
      "23514",
    );
    expect(await refusal(append(store, rate(store, { ...at, rate: "0" })))).toBe("RangeError");
    const largest = await append(store, rate(store, { ...at, rate: "999999999999.999999" }));
    expect(largest.rate).toBe("999999999999.999999");
  });

  it("name both the device and the operation of a rate set offline, or neither", async () => {
    const record = rate(store, {
      unitCurrency: "USD",
      quoteCurrency: "SYP",
      rate: "12900",
      effectiveAt: "2026-09-02T00:00:00Z",
    });
    const offline = await append(store, {
      ...record,
      offline: { deviceId: newId(), opId: newId() },
    });
    expect(offline.deviceId).not.toBeNull();
    expect(
      await refusal(
        inTenant(store, (tx) =>
          tx.execute(sql`
            insert into core_currency.exchange_rates
              (id, tenant_id, branch_id, created_at, created_by, unit_currency, quote_currency, rate, effective_at, device_id)
            values (${newId()}, ${store.tenantId}, ${store.branchId}, now(), ${store.ownerId},
              'USD', 'SYP', 13000, now(), ${newId()})`),
        ),
      ),
    ).toBe("23514");
  });

  it("may name any of the tenant's currencies; whether it is enabled is the route's check", async () => {
    const tryRate = await append(
      store,
      rate(store, {
        unitCurrency: "TRY",
        quoteCurrency: "SYP",
        rate: "300",
        effectiveAt: "2026-09-28T07:00:00Z",
      }),
    );
    expect(tryRate).toMatchObject({ unitCurrency: "TRY", quoteCurrency: "SYP", rate: "300" });
  });

  describe("the current rate of a pair", () => {
    it("is the latest effectiveAt, not the last recorded; a late older rate is history", async () => {
      const pair = { unitCurrency: "USD", quoteCurrency: "TRY" } as const;
      // Two devices offline: 9:00 at 44 and 9:05 at 43; the 9:05 one arrives first.
      await append(
        dollarStore,
        rate(dollarStore, { ...pair, rate: "43", effectiveAt: "2026-09-28T06:05:00Z" }),
      );
      await append(
        dollarStore,
        rate(dollarStore, { ...pair, rate: "44", effectiveAt: "2026-09-28T06:00:00Z" }),
      );
      const current = await inTenant(dollarStore, currentExchangeRates);
      expect(current.map((r) => [r.unitCurrency, r.quoteCurrency, r.rate])).toEqual([
        ["USD", "TRY", "43"],
      ]);
      const history = await inTenant(dollarStore, listExchangeRates);
      expect(history.map((r) => r.rate)).toEqual(["43", "44"]);
    });

    it("breaks a tie on effectiveAt by the greater id", async () => {
      const at = "2026-09-28T09:00:00Z";
      const pair = { unitCurrency: "USD", quoteCurrency: "SYP" } as const;
      const [lower = "", higher = ""] = [newId(), newId()].sort();
      // The higher id is recorded first, so recording order would pick the other.
      await append(store, rate(store, { ...pair, rate: "13100", effectiveAt: at, id: higher }));
      await append(store, rate(store, { ...pair, rate: "13050", effectiveAt: at, id: lower }));
      const current = await inTenant(store, currentExchangeRates);
      expect(current.map((r) => [r.unitCurrency, r.quoteCurrency, r.rate, r.id])).toEqual([
        ["TRY", "SYP", "300", expect.any(String)],
        ["USD", "SYP", "13100", higher],
      ]);
    });

    it("is kept per tenant", async () => {
      const theirs = await inTenant(dollarStore, currentExchangeRates);
      expect(theirs.every((r) => r.unitCurrency === "USD" && r.quoteCurrency === "TRY")).toBe(true);
    });
  });

  describe("are append-only at the database (rule 8)", () => {
    let rateId: string;

    beforeAll(async () => {
      const appended = await append(
        store,
        rate(store, {
          unitCurrency: "USD",
          quoteCurrency: "SYP",
          rate: "13000",
          effectiveAt: "2026-09-03T00:00:00Z",
        }),
      );
      rateId = appended.id;
    });

    it.each([
      ["update", () => sql`update core_currency.exchange_rates set rate = 1 where id = ${rateId}`],
      ["delete", () => sql`delete from core_currency.exchange_rates where id = ${rateId}`],
    ])("refuses the app role: %s", async (_, statement) => {
      expect(await refusal(inTenant(store, (tx) => tx.execute(statement())))).toBe("42501");
    });

    it.each([
      ["update", "update core_currency.exchange_rates set rate = 1 where id = $1"],
      ["delete", "delete from core_currency.exchange_rates where id = $1"],
    ])("refuses even a superuser: %s", async (_, statement) => {
      expect(await refusal(superuser.query(statement, [rateId]))).toBe("42501");
    });

    it("refuses to truncate", async () => {
      const owner = await database.connect("owner");
      try {
        expect(await refusal(owner.query("truncate core_currency.exchange_rates"))).toBe("42501");
      } finally {
        await owner.end();
      }
    });

    it("leaves the rate as it was set", async () => {
      const { rows } = await superuser.query(
        "select rate from core_currency.exchange_rates where id = $1",
        [rateId],
      );
      expect(rows).toEqual([{ rate: "13000.000000" }]);
    });
  });
});
