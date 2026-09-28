import { recordAudit } from "@mustawfi/core-audit/server";
import { ProblemError } from "@mustawfi/core-config/server";
import { recordChange } from "@mustawfi/core-sync/server";
import { currentTenant, type TenantTransaction } from "@mustawfi/core-tenancy/server";
import { Decimal, ExchangeRate, type IdGenerator } from "@mustawfi/kernel";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  baseCurrencySchema,
  type BaseCurrencyCode,
  catalogCurrency,
  type CurrencyCode,
  currencyCodeSchema,
  currencyProblemCodes,
  EXCHANGE_RATE_ENTITY,
  type ExchangeRateView,
  type ExchangeRateWire,
  rateChangeNeedsConfirmation,
  rateChangePercent,
  ratePairProblem,
} from "../shared/index.ts";
import { listTenantCurrencies, readCurrencySettings } from "./currencies.ts";
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
 * is stored as history and changes nothing current. It neither audits nor publishes the rate:
 * `setExchangeRate` and the `currency.rate.set` operation do.
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

/** A rate as the route answers it and devices pull it. */
export function exchangeRateWire(view: ExchangeRateView): ExchangeRateWire {
  return {
    ...view,
    effectiveAt: view.effectiveAt.toISOString(),
    recordedAt: view.recordedAt.toISOString(),
  };
}

/** Latest `effectiveAt` first, ties by the greater id (rule 8). */
const latestFirst = [desc(exchangeRates.effectiveAt), desc(exchangeRates.id)] as const;

/**
 * The current rate of each pair the tenant has rates for (`core-money` rule 8): the one with
 * the latest `effectiveAt`, ties broken by the greater id — never the one recorded last.
 */
export async function currentExchangeRates(tx: TenantTransaction): Promise<ExchangeRateView[]> {
  const rows = await tx
    .selectDistinctOn([exchangeRates.unitCurrency, exchangeRates.quoteCurrency])
    .from(exchangeRates)
    .orderBy(exchangeRates.unitCurrency, exchangeRates.quoteCurrency, ...latestFirst);
  return rows.map(rateView);
}

/** The current rate of one pair (rule 8), if it has any. */
export async function currentExchangeRate(
  tx: TenantTransaction,
  pair: { readonly unitCurrency: CurrencyCode; readonly quoteCurrency: CurrencyCode },
): Promise<ExchangeRateView | undefined> {
  const [row] = await tx
    .select()
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.unitCurrency, pair.unitCurrency),
        eq(exchangeRates.quoteCurrency, pair.quoteCurrency),
      ),
    )
    .orderBy(...latestFirst)
    .limit(1);
  return row === undefined ? undefined : rateView(row);
}

/** The tenant's rates, the latest first (by `effectiveAt`, then id); `limit` of them when given. */
export async function listExchangeRates(
  tx: TenantTransaction,
  limit?: number,
): Promise<ExchangeRateView[]> {
  const query = tx
    .select()
    .from(exchangeRates)
    .orderBy(...latestFirst);
  const rows = limit === undefined ? await query : await query.limit(limit);
  return rows.map(rateView);
}

/** The tenant's base currency, which every rate pairs with (rule 6). */
export async function tenantBaseCurrency(tx: TenantTransaction): Promise<BaseCurrencyCode> {
  const tenant = await currentTenant(tx);
  if (tenant === undefined) throw new Error("a rate outside a tenant");
  return baseCurrencySchema.parse(tenant.baseCurrency);
}

/**
 * Holds the pair's rates of the current tenant until `tx` ends, so the current rate a new one is
 * checked and audited against cannot change underneath it (reentrant within `tx`).
 */
async function lockPair(
  tx: TenantTransaction,
  tenantId: string,
  pair: { readonly unitCurrency: CurrencyCode; readonly quoteCurrency: CurrencyCode },
): Promise<void> {
  const key = `core_currency.rate:${tenantId}:${pair.unitCurrency}/${pair.quoteCurrency}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/** Whether `rate` orders after `other` (rule 8): a later `effectiveAt`, ties by the greater id. */
function isLater(rate: ExchangeRateView, other: ExchangeRateView): boolean {
  const byTime = rate.effectiveAt.getTime() - other.effectiveAt.getTime();
  return byTime === 0 ? rate.id > other.id : byTime > 0;
}

/** Who set a rate, and where. */
export interface RateActor {
  /** Must be the tenant of the `withTenant` context `tx` runs in. */
  readonly tenantId: string;
  readonly branchId: string;
  readonly userId: string;
  /** The device the user set it on, signed in there or offline; absent from a browser. */
  readonly deviceId?: string;
}

export interface RecordedRate {
  readonly rate: ExchangeRateView;
  /** The pair's current rate before this one, if it had one. */
  readonly before: ExchangeRateView | undefined;
  /** Whether it became the pair's current rate: not when it is older than that (rule 8). */
  readonly current: boolean;
}

/**
 * Appends `record`, audits it (`currency.rate.set`, rule 10) with the pair's current rate before
 * it, and publishes it to the change log devices pull from — history included, so every device
 * shows it and converges on the same current rate (rule 8). `confirmed` is what the user
 * confirmed; `deviceEffectiveAt`, a device's own time when the server moved it.
 */
export async function recordExchangeRate(
  tx: TenantTransaction,
  actor: RateActor,
  record: ExchangeRateRecord,
  audit: { readonly confirmed: boolean; readonly deviceEffectiveAt?: Date },
  dependencies: { readonly newId: IdGenerator },
): Promise<RecordedRate> {
  await lockPair(tx, actor.tenantId, record);
  const before = await currentExchangeRate(tx, record);
  const rate = await appendExchangeRate(tx, record);
  const current = before === undefined || isLater(rate, before);
  await recordAudit(tx, {
    id: dependencies.newId(),
    tenantId: actor.tenantId,
    branchId: actor.branchId,
    occurredAt: record.recordedAt,
    userId: actor.userId,
    ...(actor.deviceId === undefined ? {} : { deviceId: actor.deviceId }),
    action: "currency.rate.set",
    entity: { type: EXCHANGE_RATE_ENTITY, id: rate.id },
    ...(before === undefined
      ? {}
      : { before: { rate: before.rate, effectiveAt: before.effectiveAt.toISOString() } }),
    after: {
      unitCurrency: rate.unitCurrency,
      quoteCurrency: rate.quoteCurrency,
      rate: rate.rate,
      effectiveAt: rate.effectiveAt.toISOString(),
      ...(audit.deviceEffectiveAt === undefined
        ? {}
        : { deviceEffectiveAt: audit.deviceEffectiveAt.toISOString() }),
      confirmed: audit.confirmed,
      current,
    },
  });
  await recordChange(
    tx,
    {
      tenantId: actor.tenantId,
      branchId: actor.branchId,
      createdAt: record.recordedAt,
      createdBy: actor.userId,
      entity: EXCHANGE_RATE_ENTITY,
      entityId: rate.id,
      row: exchangeRateWire(rate),
    },
    dependencies,
  );
  return { rate, before, current };
}

export interface OnlineRate {
  readonly id: string;
  readonly unitCurrency: CurrencyCode;
  readonly quoteCurrency: CurrencyCode;
  readonly rate: Decimal;
  readonly confirmed: boolean;
  /** The server's time: the rate is effective and recorded now (rule 9). */
  readonly at: Date;
}

/**
 * Sets a rate online (`POST /api/v1/currency/rates`) in `tx`: for the base and an enabled foreign
 * currency, quoted the ADR-0031 way (422 `currency.rate.invalidPair`, rule 6), confirmed when it
 * moves beyond the tenant's threshold from the current rate (422
 * `currency.rate.confirmationRequired`, rule 11); effective now, audited, and published. The
 * route checks the permission.
 */
export async function setExchangeRate(
  tx: TenantTransaction,
  actor: RateActor,
  input: OnlineRate,
  dependencies: { readonly newId: IdGenerator },
): Promise<RecordedRate> {
  const base = await tenantBaseCurrency(tx);
  const enabled = new Set(
    (await listTenantCurrencies(tx)).filter((c) => c.enabled).map((c) => c.code),
  );
  const problem = ratePairProblem(base, input, enabled);
  if (problem !== undefined) {
    throw new ProblemError(currencyProblemCodes.invalidPair, 422, {
      title: "A rate is for the base and an enabled foreign currency, per 1 unit of the stronger",
      detail: `${input.quoteCurrency} per 1 ${input.unitCurrency}: ${problem}`,
    });
  }
  await lockPair(tx, actor.tenantId, input);
  const current = await currentExchangeRate(tx, input);
  if (current !== undefined && !input.confirmed) {
    const { rateChangeThresholdPercent } = await readCurrencySettings(tx);
    const previous = Decimal.of(current.rate);
    if (rateChangeNeedsConfirmation(previous, input.rate, rateChangeThresholdPercent)) {
      throw new ProblemError(currencyProblemCodes.confirmationRequired, 422, {
        title: "The rate moves beyond the threshold: confirm it",
        detail: `from ${current.rate} to ${input.rate.toString()} (${rateChangePercent(previous, input.rate).toString()}%), threshold ${String(rateChangeThresholdPercent)}%`,
      });
    }
  }
  return recordExchangeRate(
    tx,
    actor,
    {
      id: input.id,
      tenantId: actor.tenantId,
      branchId: actor.branchId,
      unitCurrency: input.unitCurrency,
      quoteCurrency: input.quoteCurrency,
      rate: input.rate,
      effectiveAt: input.at,
      recordedAt: input.at,
      setBy: actor.userId,
    },
    { confirmed: input.confirmed },
    dependencies,
  );
}
