import { businessDate } from "@mustawfi/core-tenancy/shared";
import { Decimal, ExchangeRate, Money } from "@mustawfi/kernel";
import {
  type BaseCurrencyCode,
  catalogCurrency,
  type CurrencyCode,
  quotedPair,
  rateChangeNeedsConfirmation,
  rateChangePercent,
  type TenantCurrencyView,
} from "../../shared/index.ts";

/** Where a rate was set, as the rates screen says it. */
export type RateSource = "online" | "thisDevice" | "otherDevice";

/** A rate as the rates screen shows it, from this device's database or from the server. */
export interface RateLine {
  readonly id: string;
  readonly unitCurrency: CurrencyCode;
  readonly quoteCurrency: CurrencyCode;
  /** Canonical decimal text. */
  readonly rate: string;
  readonly effectiveAt: string;
  /** Who set it: a user id. */
  readonly setBy: string;
  /** Who set it, by name, when the server named them. */
  readonly setByName: string | null;
  readonly source: RateSource;
  /** The device's name, when the server named it. */
  readonly deviceName: string | null;
  /** Set on this device and not yet recorded by the server. */
  readonly pending: boolean;
}

/** What the rates screen shows. */
export interface RatesData {
  readonly baseCurrency: BaseCurrencyCode;
  /** The enabled foreign currencies, in catalog order: each takes a rate against the base. */
  readonly foreign: readonly TenantCurrencyView[];
  readonly thresholdPercent: number;
  /** The current rate of each pair (rule 8). */
  readonly current: readonly RateLine[];
  /** The latest rates, the latest first. */
  readonly history: readonly RateLine[];
}

/** What the screen asks to set: a new rate for the pair of the base and `currency`. */
export interface NewRate {
  readonly currency: CurrencyCode;
  readonly unitCurrency: CurrencyCode;
  readonly quoteCurrency: CurrencyCode;
  /** Canonical decimal text, checked by `exchangeRateValueSchema`. */
  readonly rate: string;
  /** The user confirmed a change beyond the threshold (rule 11). */
  readonly confirmed: boolean;
}

/** The enabled foreign currencies of `base`, in catalog order. */
export function enabledForeign(
  base: BaseCurrencyCode,
  currencies: readonly TenantCurrencyView[],
): TenantCurrencyView[] {
  return currencies.filter((currency) => currency.enabled && currency.code !== base);
}

/** The current rate of the pair of the base and `currency`, if it has one. */
export function currentRateOf(
  data: Pick<RatesData, "baseCurrency" | "current">,
  currency: CurrencyCode,
): RateLine | undefined {
  const pair = quotedPair(data.baseCurrency, currency);
  return data.current.find(
    (rate) => rate.unitCurrency === pair.unitCurrency && rate.quoteCurrency === pair.quoteCurrency,
  );
}

/**
 * Whether a rate was set before the start of the business day of `now` (rule 12, Asia/Damascus):
 * the rate in use is yesterday's, or older.
 */
export function isStaleRate(rate: Pick<RateLine, "effectiveAt">, now: Date): boolean {
  return businessDate(new Date(rate.effectiveAt)) < businessDate(now);
}

/** A foreign currency the stale-rate banner names: with an old rate, or with none (rule 12). */
export type StaleCurrency =
  | { readonly currency: CurrencyCode; readonly state: "old"; readonly rate: RateLine }
  | { readonly currency: CurrencyCode; readonly state: "missing" };

/** The enabled foreign currencies whose current rate predates the business day, or is missing. */
export function staleCurrencies(
  data: Pick<RatesData, "baseCurrency" | "foreign" | "current">,
  now: Date,
): StaleCurrency[] {
  return data.foreign.flatMap((foreign): StaleCurrency[] => {
    const rate = currentRateOf(data, foreign.code);
    if (rate === undefined) return [{ currency: foreign.code, state: "missing" }];
    return isStaleRate(rate, now) ? [{ currency: foreign.code, state: "old", rate }] : [];
  });
}

/** The confirmation a new rate needs (rule 11): the old rate, the change, and an example. */
export interface RateChange {
  readonly current: string;
  readonly next: string;
  /** Signed, two decimals. */
  readonly percent: string;
  /** 100 units of the pair's unit currency in its quote currency, at the new rate. */
  readonly example: { readonly from: Money; readonly to: Money };
}

/** 100 units of the pair's unit currency, converted at `rate` (named rounding point 2). */
export function rateExample(
  pair: { readonly unitCurrency: CurrencyCode; readonly quoteCurrency: CurrencyCode },
  rate: string,
): { readonly from: Money; readonly to: Money } {
  const unit = catalogCurrency(pair.unitCurrency);
  const from = Money.of("100", unit);
  const to = ExchangeRate.of({
    unitCurrency: unit,
    quoteCurrency: catalogCurrency(pair.quoteCurrency),
    rate: Decimal.of(rate),
  }).convert(from, "halfAwayFromZero");
  return { from, to };
}

/**
 * The confirmation `next` needs against the pair's current rate (rule 11): none without a
 * current rate or within the threshold, compared exactly as the server does.
 */
export function rateChangeToConfirm(
  current: RateLine | undefined,
  next: string,
  thresholdPercent: number,
): RateChange | undefined {
  if (current === undefined) return undefined;
  const previous = Decimal.of(current.rate);
  const value = Decimal.of(next);
  if (!rateChangeNeedsConfirmation(previous, value, thresholdPercent)) return undefined;
  return {
    current: current.rate,
    next: value.toString(),
    percent: rateChangePercent(previous, value).toString(),
    example: rateExample(current, next),
  };
}
