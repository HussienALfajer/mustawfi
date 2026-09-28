import { enqueueOperation, type PullApplier } from "@mustawfi/core-sync/client";
import type { SyncValues } from "@mustawfi/core-sync/shared";
import { deviceTime } from "@mustawfi/core-tenancy/client";
import { type Clock, Decimal, type IdGenerator } from "@mustawfi/kernel";
import {
  int64,
  type LocalDb,
  type LocalExecutor,
  type LocalMigration,
  localOrm,
  safeInteger,
} from "@mustawfi/local-db";
import { queryOptions } from "@tanstack/react-query";
import { and, desc, eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  baseCurrencySchema,
  CURRENCY_CODES,
  DEFAULT_RATE_CHANGE_THRESHOLD_PERCENT,
  CURRENCY_SETTINGS_ENTITY,
  type CurrencyCode,
  currencyCodeSchema,
  currencySettingsSchema,
  type CurrencySettingsView,
  EXCHANGE_RATE_ENTITY,
  exchangeRateSchema,
  exchangeRateValueSchema,
  quotedPair,
  RATE_SET_OPERATION,
  rateChangeNeedsConfirmation,
  rateChangePercent,
  type RatePairProblem,
  ratePairProblem,
  type RateSetPayloadV1,
  TENANT_CURRENCY_ENTITY,
  tenantCurrencySchema,
  type TenantCurrencyView,
} from "../shared/index.ts";

/** Rates keep six decimals (`numeric(20,6)`, ADR-0018); stored scaled by 10^6. */
const RATE_SCALE = 6;
/** Cash-rounding steps are `numeric(20,4)`; stored scaled by 10^4. */
const STEP_SCALE = 4;

/** The tenant's currencies as the server last sent them, with their catalog fields. */
const localTenantCurrencies = sqliteTable("currency_tenant_currencies", {
  code: text().primaryKey(),
  id: text().notNull(),
  minorUnits: safeInteger("minor_units").notNull(),
  strengthRank: safeInteger("strength_rank").notNull(),
  enabled: integer({ mode: "boolean" }).notNull(),
  cashRoundingStepScaled: int64("cash_rounding_step_scaled").notNull(),
});

/** The tenant's currency settings as the server last sent them: one row. */
const localCurrencySettings = sqliteTable("currency_settings", {
  id: text().primaryKey(),
  changeCurrency: text("change_currency").notNull(),
  rateChangeThresholdPercent: safeInteger("rate_change_threshold_percent").notNull(),
});

/**
 * Exchange rates: every rate the server sent, and the ones set on this device before it heard
 * back (`recordedAt` null until then). A pulled row replaces the device's own by id, so every
 * device ends with the server's rows and the same current rate (rule 8).
 */
const localExchangeRates = sqliteTable("currency_exchange_rates", {
  id: text().primaryKey(),
  unitCurrency: text("unit_currency").notNull(),
  quoteCurrency: text("quote_currency").notNull(),
  rateScaled: int64("rate_scaled").notNull(),
  /** Milliseconds since the epoch. */
  effectiveAt: safeInteger("effective_at").notNull(),
  recordedAt: safeInteger("recorded_at"),
  setBy: text("set_by").notNull(),
  deviceId: text("device_id"),
  opId: text("op_id"),
});

export const LOCAL_TENANT_CURRENCIES_TABLE = "currency_tenant_currencies";
export const LOCAL_CURRENCY_SETTINGS_TABLE = "currency_settings";
export const LOCAL_EXCHANGE_RATES_TABLE = "currency_exchange_rates";

/**
 * `core.currency`'s local schema (ADR-0019), from `core-money` slice 2. The app appends it at
 * the end of `LOCAL_MIGRATIONS`: devices match applied migrations by position.
 */
export const currencyLocalMigrations: readonly LocalMigration[] = [
  {
    id: "core.currency.0001_rates",
    statements: [
      `CREATE TABLE currency_tenant_currencies (
        code TEXT PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        minor_units INTEGER NOT NULL CHECK (minor_units >= 0),
        strength_rank INTEGER NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        cash_rounding_step_scaled INTEGER NOT NULL CHECK (cash_rounding_step_scaled > 0)
      ) STRICT`,
      `CREATE TABLE currency_settings (
        id TEXT PRIMARY KEY,
        change_currency TEXT NOT NULL,
        rate_change_threshold_percent INTEGER NOT NULL
          CHECK (rate_change_threshold_percent BETWEEN 1 AND 100)
      ) STRICT`,
      `CREATE TABLE currency_exchange_rates (
        id TEXT PRIMARY KEY,
        unit_currency TEXT NOT NULL,
        quote_currency TEXT NOT NULL,
        rate_scaled INTEGER NOT NULL CHECK (rate_scaled > 0),
        effective_at INTEGER NOT NULL,
        recorded_at INTEGER,
        set_by TEXT NOT NULL,
        device_id TEXT,
        op_id TEXT
      ) STRICT`,
      `CREATE INDEX currency_exchange_rates_current
        ON currency_exchange_rates (unit_currency, quote_currency, effective_at, id)`,
    ],
  },
];

/** A rate as this device holds it: `recordedAt` is null until the server recorded it. */
export interface LocalExchangeRate {
  readonly id: string;
  readonly unitCurrency: CurrencyCode;
  readonly quoteCurrency: CurrencyCode;
  /** Canonical decimal text, at most 6 decimals. */
  readonly rate: string;
  readonly effectiveAt: string;
  readonly recordedAt: string | null;
  readonly setBy: string;
  readonly deviceId: string | null;
  readonly opId: string | null;
}

type LocalRateRow = typeof localExchangeRates.$inferSelect;

function rateOf(row: LocalRateRow): LocalExchangeRate {
  return {
    id: row.id,
    unitCurrency: currencyCodeSchema.parse(row.unitCurrency),
    quoteCurrency: currencyCodeSchema.parse(row.quoteCurrency),
    rate: Decimal.fromScaledInteger(row.rateScaled, RATE_SCALE).toString(),
    effectiveAt: new Date(row.effectiveAt).toISOString(),
    recordedAt: row.recordedAt === null ? null : new Date(row.recordedAt).toISOString(),
    setBy: row.setBy,
    deviceId: row.deviceId,
    opId: row.opId,
  };
}

/** Applies pulled `currency.tenantCurrency` changes: the full row, or a tombstone. */
export const tenantCurrencyPullApplier: PullApplier = {
  entity: TENANT_CURRENCY_ENTITY,
  async apply(tx, change) {
    const orm = localOrm(tx);
    if (change.row === null) {
      await orm.delete(localTenantCurrencies).where(eq(localTenantCurrencies.id, change.id));
      return;
    }
    const currency = tenantCurrencySchema.parse(change.row);
    const row = {
      id: change.id,
      minorUnits: currency.minorUnits,
      strengthRank: currency.strengthRank,
      enabled: currency.enabled,
      cashRoundingStepScaled: Decimal.of(currency.cashRoundingStep).toScaledInteger(STEP_SCALE),
    };
    await orm
      .insert(localTenantCurrencies)
      .values({ code: currency.code, ...row })
      .onConflictDoUpdate({ target: localTenantCurrencies.code, set: row });
  },
};

/** Applies pulled `currency.settings` changes. */
export const currencySettingsPullApplier: PullApplier = {
  entity: CURRENCY_SETTINGS_ENTITY,
  async apply(tx, change) {
    const orm = localOrm(tx);
    if (change.row === null) {
      await orm.delete(localCurrencySettings).where(eq(localCurrencySettings.id, change.id));
      return;
    }
    const row = currencySettingsSchema.parse(change.row);
    await orm
      .insert(localCurrencySettings)
      .values({ id: change.id, ...row })
      .onConflictDoUpdate({ target: localCurrencySettings.id, set: row });
  },
};

/**
 * Applies pulled `currency.exchangeRate` changes. A rate this device set replaces its own copy:
 * the server's row carries when it recorded it, and its effective time if the server moved it.
 */
export const exchangeRatePullApplier: PullApplier = {
  entity: EXCHANGE_RATE_ENTITY,
  async apply(tx, change) {
    const orm = localOrm(tx);
    if (change.row === null) {
      await orm.delete(localExchangeRates).where(eq(localExchangeRates.id, change.id));
      return;
    }
    const rate = exchangeRateSchema.parse(change.row);
    const row = {
      unitCurrency: rate.unitCurrency,
      quoteCurrency: rate.quoteCurrency,
      rateScaled: Decimal.of(rate.rate).toScaledInteger(RATE_SCALE),
      effectiveAt: Date.parse(rate.effectiveAt),
      recordedAt: Date.parse(rate.recordedAt),
      setBy: rate.setBy,
      deviceId: rate.deviceId,
      opId: rate.opId,
    };
    await orm
      .insert(localExchangeRates)
      .values({ id: rate.id, ...row })
      .onConflictDoUpdate({ target: localExchangeRates.id, set: row });
  },
};

/** The pull appliers of `core.currency`, for the app's sync engine. */
export const currencyPullAppliers: readonly PullApplier[] = [
  tenantCurrencyPullApplier,
  currencySettingsPullApplier,
  exchangeRatePullApplier,
];

/** The tenant's currencies on this device, in catalog order. */
export async function listLocalTenantCurrencies(
  executor: LocalExecutor,
): Promise<TenantCurrencyView[]> {
  const rows = await localOrm(executor).select().from(localTenantCurrencies);
  return rows
    .map((row) => {
      const code = currencyCodeSchema.parse(row.code);
      return {
        code,
        minorUnits: row.minorUnits,
        strengthRank: row.strengthRank,
        enabled: row.enabled,
        cashRoundingStep: Decimal.fromScaledInteger(
          row.cashRoundingStepScaled,
          STEP_SCALE,
        ).toStringAtScale(row.minorUnits),
      };
    })
    .sort((a, b) => CURRENCY_CODES.indexOf(a.code) - CURRENCY_CODES.indexOf(b.code));
}

/** The tenant's currency settings on this device, once pulled. */
export async function localCurrencySettingsOf(
  executor: LocalExecutor,
): Promise<CurrencySettingsView | undefined> {
  const row = await localOrm(executor).select().from(localCurrencySettings).get();
  return row === undefined
    ? undefined
    : {
        changeCurrency: currencyCodeSchema.parse(row.changeCurrency),
        rateChangeThresholdPercent: row.rateChangeThresholdPercent,
      };
}

/** Latest `effectiveAt` first, ties by the greater id (rule 8). */
const latestFirst = [desc(localExchangeRates.effectiveAt), desc(localExchangeRates.id)] as const;

/** The current rate of one pair on this device (rule 8), if it has any. */
export async function localCurrentRate(
  executor: LocalExecutor,
  pair: { readonly unitCurrency: CurrencyCode; readonly quoteCurrency: CurrencyCode },
): Promise<LocalExchangeRate | undefined> {
  const row = await localOrm(executor)
    .select()
    .from(localExchangeRates)
    .where(
      and(
        eq(localExchangeRates.unitCurrency, pair.unitCurrency),
        eq(localExchangeRates.quoteCurrency, pair.quoteCurrency),
      ),
    )
    .orderBy(...latestFirst)
    .limit(1)
    .get();
  return row === undefined ? undefined : rateOf(row);
}

/**
 * The current rate of each pair this device has rates for (rule 8): the latest `effectiveAt`,
 * ties by the greater id — the same choice the server makes, so devices agree once synced.
 */
export async function listLocalCurrentRates(executor: LocalExecutor): Promise<LocalExchangeRate[]> {
  const current: LocalExchangeRate[] = [];
  for (const [index, a] of CURRENCY_CODES.entries()) {
    for (const b of CURRENCY_CODES.slice(index + 1)) {
      const rate = await localCurrentRate(executor, quotedPair(a, b));
      if (rate !== undefined) current.push(rate);
    }
  }
  return current;
}

/** The rates on this device, the latest first; `limit` of them when given. */
export async function listLocalExchangeRates(
  executor: LocalExecutor,
  limit?: number,
): Promise<LocalExchangeRate[]> {
  const query = localOrm(executor)
    .select()
    .from(localExchangeRates)
    .orderBy(...latestFirst);
  const rows = limit === undefined ? await query : await query.limit(limit);
  return rows.map(rateOf);
}

/** Why this device does not set a rate: the pair (rule 6), a malformed rate, or rule 11. */
export type DeviceRateRefusal = RatePairProblem | "rateInvalid" | "confirmationRequired";

/** Thrown by `setDeviceExchangeRate`; nothing was written. */
export class DeviceRateRefused extends Error {
  override name = "DeviceRateRefused";
  readonly reason: DeviceRateRefusal;
  /** For `confirmationRequired`: the pair's current rate and the change from it, in percent. */
  readonly change: { readonly current: LocalExchangeRate; readonly percent: string } | undefined;

  constructor(
    reason: DeviceRateRefusal,
    change?: { readonly current: LocalExchangeRate; readonly percent: string },
  ) {
    super(`the rate was not set: ${reason}`);
    this.reason = reason;
    this.change = change;
  }
}

export interface DeviceRateInput {
  /** This device: its id, and its store's base currency, which every rate pairs with. */
  readonly device: { readonly deviceId: string; readonly baseCurrency: string };
  readonly userId: string;
  readonly shiftId: string;
  readonly unitCurrency: CurrencyCode;
  readonly quoteCurrency: CurrencyCode;
  /** Decimal text: positive, at most 6 decimals and 12 whole digits (rule 7). */
  readonly rate: string;
  /** The user confirmed a change beyond the threshold (rule 11). */
  readonly confirmed: boolean;
  readonly clock: Clock;
  readonly newId: IdGenerator;
}

/**
 * Sets a rate on this device, online or not (`core-money` rule 9): the rate, effective at the
 * device's guarded time, applies here at once, and its `currency.rate.set` operation commits in
 * the same local transaction, to reach the server at the next sync. Refused (`DeviceRateRefused`,
 * nothing written) for a pair that is not the base and an enabled foreign currency quoted the
 * ADR-0031 way, a malformed rate, and a change beyond the store's threshold not yet confirmed.
 */
export async function setDeviceExchangeRate(
  db: LocalDb,
  input: DeviceRateInput,
): Promise<LocalExchangeRate> {
  const rate = exchangeRateValueSchema.safeParse(input.rate);
  if (!rate.success) throw new DeviceRateRefused("rateInvalid");
  const base = baseCurrencySchema.parse(input.device.baseCurrency);
  const pair = { unitCurrency: input.unitCurrency, quoteCurrency: input.quoteCurrency };
  return db.transaction(async (tx) => {
    const enabled = new Set(
      (await listLocalTenantCurrencies(tx)).filter((c) => c.enabled).map((c) => c.code),
    );
    const problem = ratePairProblem(base, pair, enabled);
    if (problem !== undefined) throw new DeviceRateRefused(problem);
    const value = Decimal.of(rate.data);
    const current = await localCurrentRate(tx, pair);
    // Before the settings are pulled, the default threshold still guards a mistyped rate.
    const threshold =
      (await localCurrencySettingsOf(tx))?.rateChangeThresholdPercent ??
      DEFAULT_RATE_CHANGE_THRESHOLD_PERCENT;
    if (current !== undefined && !input.confirmed) {
      const previous = Decimal.of(current.rate);
      if (rateChangeNeedsConfirmation(previous, value, threshold)) {
        throw new DeviceRateRefused("confirmationRequired", {
          current,
          percent: rateChangePercent(previous, value).toString(),
        });
      }
    }
    const effectiveAt = await deviceTime(tx, input.clock);
    const id = input.newId();
    const opId = input.newId();
    const row = {
      id,
      unitCurrency: pair.unitCurrency,
      quoteCurrency: pair.quoteCurrency,
      rateScaled: value.toScaledInteger(RATE_SCALE),
      effectiveAt: effectiveAt.getTime(),
      recordedAt: null,
      setBy: input.userId,
      deviceId: input.device.deviceId,
      opId,
    };
    await localOrm(tx).insert(localExchangeRates).values(row);
    const payload: RateSetPayloadV1 = {
      rateId: id,
      unitCurrency: pair.unitCurrency,
      quoteCurrency: pair.quoteCurrency,
      rate: value.toString(),
      effectiveAt: effectiveAt.toISOString(),
      confirmed: input.confirmed,
    };
    await enqueueOperation(tx, {
      opId,
      deviceId: input.device.deviceId,
      type: RATE_SET_OPERATION,
      payloadVersion: 1,
      payload: payload satisfies SyncValues,
      userId: input.userId,
      shiftId: input.shiftId,
      createdAt: effectiveAt,
    });
    return rateOf(row);
  });
}

export const localCurrentRatesQueryKey = ["local", "currency", "currentRates"] as const;

/** The current rates on this device, for the rates screen and the POS; refreshed on each write. */
export function localCurrentRatesQueryOptions(db: LocalDb) {
  return queryOptions({
    queryKey: localCurrentRatesQueryKey,
    queryFn: () => listLocalCurrentRates(db),
    networkMode: "always",
    meta: { localTables: [LOCAL_EXCHANGE_RATES_TABLE] },
  });
}

export const localTenantCurrenciesQueryKey = ["local", "currency", "tenantCurrencies"] as const;

/** The tenant's currencies on this device. */
export function localTenantCurrenciesQueryOptions(db: LocalDb) {
  return queryOptions({
    queryKey: localTenantCurrenciesQueryKey,
    queryFn: () => listLocalTenantCurrencies(db),
    networkMode: "always",
    meta: { localTables: [LOCAL_TENANT_CURRENCIES_TABLE] },
  });
}
