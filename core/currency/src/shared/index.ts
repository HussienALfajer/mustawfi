import type { CurrencyCode } from "./catalog.ts";

export {
  BASE_CURRENCY_CODES,
  type BaseCurrencyCode,
  baseCurrencySchema,
  CASH_ROUNDING_STEP_MAX,
  type CatalogEntry,
  catalogCurrencies,
  catalogCurrency,
  CURRENCY_CATALOG,
  CURRENCY_CODES,
  type CurrencyCode,
  currencyCodeSchema,
  DEFAULT_CASH_ROUNDING_STEPS,
  DEFAULT_CHANGE_CURRENCY,
  DEFAULT_RATE_CHANGE_THRESHOLD_PERCENT,
  defaultTenantCurrencies,
  exchangeRateValueSchema,
  findCatalogCurrency,
  isCatalogCurrency,
  isValidCashRoundingStep,
  quotedPair,
  RATE_INTEGER_DIGITS,
  type TenantCurrencyDefault,
} from "./catalog.ts";
export {
  CURRENCY_SETTINGS_ENTITY,
  currencyProblemCodes,
  currencySettingsSchema,
  EXCHANGE_RATE_ENTITY,
  exchangeRateSchema,
  type ExchangeRateWire,
  RATE_SET_OPERATION,
  RATE_SET_PERMISSION,
  rateChangeNeedsConfirmation,
  rateChangePercent,
  type RatePairProblem,
  ratePairProblem,
  type RateSetPayloadV1,
  rateSetPayloadV1Schema,
  type SetRateRequest,
  setRateRequestSchema,
  TENANT_CURRENCY_ENTITY,
  tenantCurrencySchema,
} from "./rates.ts";

/** A tenant's currency with its catalog fields, as screens and devices read it. */
export interface TenantCurrencyView {
  readonly code: CurrencyCode;
  readonly minorUnits: number;
  readonly strengthRank: number;
  readonly enabled: boolean;
  /** Canonical decimal text at the currency's minor unit (`"10.00"`). */
  readonly cashRoundingStep: string;
}

/** The tenant's currency settings (`core-money` rules 3 and 5). */
export interface CurrencySettingsView {
  readonly changeCurrency: CurrencyCode;
  readonly rateChangeThresholdPercent: number;
}

/**
 * A recorded exchange rate (ADR-0031): units of `quoteCurrency` per 1 unit of `unitCurrency`,
 * effective from `effectiveAt`; `deviceId` and `opId` are null when it was set online.
 */
export interface ExchangeRateView {
  readonly id: string;
  readonly unitCurrency: CurrencyCode;
  readonly quoteCurrency: CurrencyCode;
  /** Canonical decimal text, at most 6 decimals. */
  readonly rate: string;
  readonly effectiveAt: Date;
  readonly recordedAt: Date;
  readonly setBy: string;
  readonly deviceId: string | null;
  readonly opId: string | null;
}
