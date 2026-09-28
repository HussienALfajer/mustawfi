import { recordChange } from "@mustawfi/core-sync/server";
import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import { Decimal, type IdGenerator } from "@mustawfi/kernel";
import {
  type BaseCurrencyCode,
  catalogCurrency,
  CURRENCY_CODES,
  CURRENCY_SETTINGS_ENTITY,
  type CurrencySettingsView,
  currencyCodeSchema,
  TENANT_CURRENCY_ENTITY,
  DEFAULT_CHANGE_CURRENCY,
  DEFAULT_RATE_CHANGE_THRESHOLD_PERCENT,
  defaultTenantCurrencies,
  type TenantCurrencyView,
} from "../shared/index.ts";
import { currencySettings, tenantCurrencies } from "./schema.ts";

export interface CurrencySeed {
  /** Must be the tenant of the `withTenant` context `tx` runs in. */
  readonly tenantId: string;
  readonly branchId: string;
  readonly userId: string;
  readonly at: Date;
}

export interface SeededCurrencies {
  readonly currencies: readonly TenantCurrencyView[];
  readonly settings: CurrencySettingsView;
}

function currencyView(row: {
  code: string;
  enabled: boolean;
  cashRoundingStep: string;
}): TenantCurrencyView {
  const code = currencyCodeSchema.parse(row.code);
  const currency = catalogCurrency(code);
  return {
    code,
    minorUnits: currency.minorUnits,
    strengthRank: currency.strengthRank ?? 0,
    enabled: row.enabled,
    cashRoundingStep: Decimal.of(row.cashRoundingStep).toStringAtScale(currency.minorUnits),
  };
}

/**
 * Writes a new tenant's currencies and currency settings by its base (`core-money` rules 2–5)
 * in `tx`, the transaction that creates the tenant: one row per catalog currency — the base and
 * the other of SYP and USD enabled, TRY disabled — with the default cash-rounding steps, change
 * in SYP, and a 10% rate-change threshold — each row appended to the change log devices pull
 * from. Seeding twice fails on the per-tenant code (`23505`).
 */
export async function seedCurrencies(
  tx: TenantTransaction,
  seed: CurrencySeed,
  baseCurrency: BaseCurrencyCode,
  newId: IdGenerator,
): Promise<SeededCurrencies> {
  const standard = {
    tenantId: seed.tenantId,
    branchId: seed.branchId,
    createdAt: seed.at,
    createdBy: seed.userId,
    updatedAt: seed.at,
    updatedBy: seed.userId,
  };
  const rows = defaultTenantCurrencies(baseCurrency).map((currency) => ({
    id: newId(),
    ...standard,
    ...currency,
  }));
  await tx.insert(tenantCurrencies).values(rows);
  const settings = {
    changeCurrency: DEFAULT_CHANGE_CURRENCY,
    rateChangeThresholdPercent: DEFAULT_RATE_CHANGE_THRESHOLD_PERCENT,
  };
  const settingsId = newId();
  await tx.insert(currencySettings).values({ id: settingsId, ...standard, ...settings });
  // Devices convert and check rates offline from these (`core-money` *Offline and sync behavior*).
  const change = {
    tenantId: seed.tenantId,
    branchId: seed.branchId,
    createdAt: seed.at,
    createdBy: seed.userId,
  };
  const currencies = rows.map((row) => ({ id: row.id, view: currencyView(row) }));
  for (const { id, view } of currencies) {
    await recordChange(
      tx,
      { ...change, entity: TENANT_CURRENCY_ENTITY, entityId: id, row: { ...view } },
      { newId },
    );
  }
  await recordChange(
    tx,
    { ...change, entity: CURRENCY_SETTINGS_ENTITY, entityId: settingsId, row: { ...settings } },
    { newId },
  );
  return { currencies: currencies.map(({ view }) => view), settings };
}

/** The current tenant's currencies with their catalog fields, in catalog order. */
export async function listTenantCurrencies(tx: TenantTransaction): Promise<TenantCurrencyView[]> {
  const rows = await tx
    .select({
      code: tenantCurrencies.code,
      enabled: tenantCurrencies.enabled,
      cashRoundingStep: tenantCurrencies.cashRoundingStep,
    })
    .from(tenantCurrencies);
  return rows
    .map(currencyView)
    .sort((a, b) => CURRENCY_CODES.indexOf(a.code) - CURRENCY_CODES.indexOf(b.code));
}

/**
 * The current tenant's currency settings. Throws when there are none: every tenant is seeded
 * with them, so a gap is a defect, not a business case.
 */
export async function readCurrencySettings(tx: TenantTransaction): Promise<CurrencySettingsView> {
  const [row] = await tx
    .select({
      changeCurrency: currencySettings.changeCurrency,
      rateChangeThresholdPercent: currencySettings.rateChangeThresholdPercent,
    })
    .from(currencySettings);
  if (row === undefined) throw new Error("the tenant has no currency settings");
  return {
    changeCurrency: currencyCodeSchema.parse(row.changeCurrency),
    rateChangeThresholdPercent: row.rateChangeThresholdPercent,
  };
}
