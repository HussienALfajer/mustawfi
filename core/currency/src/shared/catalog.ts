import { Currency, Decimal, decimalString } from "@mustawfi/kernel";
import { z } from "zod";

/**
 * The currencies Mustawfi knows (`core-money` rule 1): the new Syrian pound, the US dollar,
 * and the Turkish lira. The catalog is code, shipped with every client, so devices convert and
 * format offline; the database's checks mirror it (`core_currency` migrations). A new currency
 * is a release and a migration.
 */
export const CURRENCY_CODES = ["SYP", "USD", "TRY"] as const;
export const currencyCodeSchema = z.enum(CURRENCY_CODES);
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;

/** A tenant's base currency is SYP or USD, fixed at creation (ADR-0007); TRY never is. */
export const BASE_CURRENCY_CODES = ["SYP", "USD"] as const satisfies readonly CurrencyCode[];
export const baseCurrencySchema = z.enum(BASE_CURRENCY_CODES);
export type BaseCurrencyCode = z.infer<typeof baseCurrencySchema>;

export interface CatalogEntry {
  readonly code: CurrencyCode;
  /** Digits after the point of a ledger amount (ADR-0018). */
  readonly minorUnits: number;
  /** Place in the strength order that fixes how a rate is quoted (1 = strongest, ADR-0031). */
  readonly strengthRank: number;
}

/** In the order screens list them. Arabic names and symbols are i18n keys. */
export const CURRENCY_CATALOG: readonly CatalogEntry[] = [
  { code: "SYP", minorUnits: 2, strengthRank: 3 },
  { code: "USD", minorUnits: 2, strengthRank: 1 },
  { code: "TRY", minorUnits: 2, strengthRank: 2 },
];

const CATALOG = new Map(
  CURRENCY_CATALOG.map((entry) => [
    entry.code,
    Currency.of(entry.code, entry.minorUnits, entry.strengthRank),
  ]),
);

export function isCatalogCurrency(code: string): code is CurrencyCode {
  return CATALOG.has(code as CurrencyCode);
}

/** A catalog currency as the kernel uses it: minor units and strength rank from the catalog. */
export function catalogCurrency(code: CurrencyCode): Currency {
  const currency = CATALOG.get(code);
  if (currency === undefined) throw new RangeError(`${code} is not in the currency catalog`);
  return currency;
}

/** The catalog currency with this code, if there is one. */
export function findCatalogCurrency(code: string): Currency | undefined {
  return isCatalogCurrency(code) ? CATALOG.get(code) : undefined;
}

/** Every catalog currency, in catalog order. */
export function catalogCurrencies(): readonly Currency[] {
  return CURRENCY_CATALOG.map((entry) => catalogCurrency(entry.code));
}

/**
 * How a rate between two catalog currencies is quoted (ADR-0031): units of the weaker per 1
 * unit of the stronger — SYP per 1 USD, SYP per 1 TRY, TRY per 1 USD.
 */
export function quotedPair(
  a: CurrencyCode,
  b: CurrencyCode,
): { readonly unitCurrency: CurrencyCode; readonly quoteCurrency: CurrencyCode } {
  if (a === b) throw new RangeError("A rate needs two different currencies");
  const aIsStronger =
    (catalogCurrency(a).strengthRank ?? 0) < (catalogCurrency(b).strengthRank ?? 0);
  return aIsStronger
    ? { unitCurrency: a, quoteCurrency: b }
    : { unitCurrency: b, quoteCurrency: a };
}

/**
 * A rate's value on the wire (`core-money` rule 7): positive, at most 6 decimals and 12 whole
 * digits, so it fits a device's 64-bit integer at ×10⁶ (ADR-0018 amendment).
 */
export const RATE_INTEGER_DIGITS = 12;
export const exchangeRateValueSchema = decimalString({
  scale: 6,
  precision: 6 + RATE_INTEGER_DIGITS,
  sign: "positive",
});

/** The largest cash-rounding step (`core-money` rule 4). */
export const CASH_ROUNDING_STEP_MAX = Decimal.of("1000");

/** Whether `step` is a positive multiple of the currency's minor unit, at most 1000 (rule 4). */
export function isValidCashRoundingStep(code: CurrencyCode, step: Decimal): boolean {
  return (
    step.isPositive() &&
    step.lessThanOrEqual(CASH_ROUNDING_STEP_MAX) &&
    step.scale() <= catalogCurrency(code).minorUnits
  );
}

/**
 * Defaults of a new tenant (`core-money` *Settings*): SYP rounds cash to 10 (the smallest new
 * note), USD not at all, TRY to 1; change is given in SYP; a rate moving more than 10% asks
 * for confirmation.
 */
export const DEFAULT_CASH_ROUNDING_STEPS: Readonly<Record<CurrencyCode, string>> = {
  SYP: "10",
  USD: "0.01",
  TRY: "1",
};
export const DEFAULT_CHANGE_CURRENCY: CurrencyCode = "SYP";
export const DEFAULT_RATE_CHANGE_THRESHOLD_PERCENT = 10;

export interface TenantCurrencyDefault {
  readonly code: CurrencyCode;
  readonly enabled: boolean;
  readonly cashRoundingStep: string;
}

/**
 * A new tenant's currencies by its base (`core-money` rule 2): the base and the other of SYP
 * and USD enabled, TRY disabled; one row per catalog currency.
 */
export function defaultTenantCurrencies(base: BaseCurrencyCode): TenantCurrencyDefault[] {
  const enabled = new Set<CurrencyCode>([base, base === "SYP" ? "USD" : "SYP"]);
  return CURRENCY_CATALOG.map(({ code }) => ({
    code,
    enabled: enabled.has(code),
    cashRoundingStep: DEFAULT_CASH_ROUNDING_STEPS[code],
  }));
}
