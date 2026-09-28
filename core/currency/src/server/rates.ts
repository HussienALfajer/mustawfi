import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import { Decimal, ExchangeRate } from "@mustawfi/kernel";
import { desc } from "drizzle-orm";
import {
  catalogCurrency,
  type CurrencyCode,
  currencyCodeSchema,
  type ExchangeRateView,
} from "../shared/index.ts";
import { exchangeRates } from "./schema.ts";

export interface ExchangeRateRecord {
  /** UUIDv7; with `effectiveAt`, it orders rates (rule 8). */
  readonly id: string;
  /** Must be the tenant of the `withTenant` context `tx` runs in. */
  readonly tenantId: string;
  readonly branchId: string;
  readonly unitCurrency: CurrencyCode;
  readonly quoteCurrency: CurrencyCode;
  readonly rate: Decimal;
  readonly effectiveAt: Date;
  /** When the server recorded it. */
  readonly recordedAt: Date;
  readonly setBy: string;
  /** The device and sync operation of a rate set offline; both absent for one set online. */
  readonly offline?: { readonly deviceId: string; readonly opId: string };
}

/**
 * Appends a rate (ADR-0031, `core-money` rules 6–8) in `tx`. The kernel refuses a pair quoted
 * the wrong way round (`RangeError`); the database refuses a currency the tenant does not have
 * and a rate beyond what devices hold. Whether the pair includes the base, the currency is
 * enabled, and the user may set it are the caller's checks. A rate older than the current one
 * is stored as history and changes nothing current.
 */
export async function appendExchangeRate(
  tx: TenantTransaction,
  record: ExchangeRateRecord,
): Promise<ExchangeRateView> {
  const rate = ExchangeRate.of({
    unitCurrency: catalogCurrency(record.unitCurrency),
    quoteCurrency: catalogCurrency(record.quoteCurrency),
    rate: record.rate,
  });
  const row = {
    id: record.id,
    tenantId: record.tenantId,
    branchId: record.branchId,
    createdAt: record.recordedAt,
    createdBy: record.setBy,
    unitCurrency: record.unitCurrency,
    quoteCurrency: record.quoteCurrency,
    rate: rate.rate.toString(),
    effectiveAt: record.effectiveAt,
    deviceId: record.offline?.deviceId ?? null,
    opId: record.offline?.opId ?? null,
  };
  await tx.insert(exchangeRates).values(row);
  return rateView(row);
}

function rateView(row: typeof exchangeRates.$inferSelect): ExchangeRateView {
  return {
    id: row.id,
    unitCurrency: currencyCodeSchema.parse(row.unitCurrency),
    quoteCurrency: currencyCodeSchema.parse(row.quoteCurrency),
    // `numeric(20,6)` reads back padded to six decimals; the view is canonical.
    rate: Decimal.of(row.rate).toString(),
    effectiveAt: row.effectiveAt,
    recordedAt: row.createdAt,
    setBy: row.createdBy,
    deviceId: row.deviceId,
    opId: row.opId,
  };
}

/**
 * The current rate of each pair the tenant has rates for (`core-money` rule 8): the one with
 * the latest `effectiveAt`, ties broken by the greater id — never the one recorded last.
 */
export async function currentExchangeRates(tx: TenantTransaction): Promise<ExchangeRateView[]> {
  const rows = await tx
    .selectDistinctOn([exchangeRates.unitCurrency, exchangeRates.quoteCurrency])
    .from(exchangeRates)
    .orderBy(
      exchangeRates.unitCurrency,
      exchangeRates.quoteCurrency,
      desc(exchangeRates.effectiveAt),
      desc(exchangeRates.id),
    );
  return rows.map(rateView);
}

/** Every rate of the tenant, the latest first (by `effectiveAt`, then id). */
export async function listExchangeRates(tx: TenantTransaction): Promise<ExchangeRateView[]> {
  const rows = await tx
    .select()
    .from(exchangeRates)
    .orderBy(desc(exchangeRates.effectiveAt), desc(exchangeRates.id));
  return rows.map(rateView);
}
