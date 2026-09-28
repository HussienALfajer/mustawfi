import { syncIdSchema } from "@mustawfi/core-sync/shared";
import { Decimal, decimalString } from "@mustawfi/kernel";
import { z } from "zod";
import {
  type BaseCurrencyCode,
  type CurrencyCode,
  currencyCodeSchema,
  exchangeRateValueSchema,
  quotedPair,
} from "./catalog.ts";

/** Setting a rate, online through the route or on a device through the operation (rule 10). */
export const RATE_SET_PERMISSION = "currency.rate.set";

/** The sync operation a device sets a rate with while offline (rule 9). */
export const RATE_SET_OPERATION = "currency.rate.set";

/** What devices pull (ADR-0020): each carries the full row of its schema below. */
export const TENANT_CURRENCY_ENTITY = "currency.tenantCurrency";
export const CURRENCY_SETTINGS_ENTITY = "currency.settings";
export const EXCHANGE_RATE_ENTITY = "currency.exchangeRate";

/** `POST /api/v1/currency/rates`: a new rate of the base and an enabled foreign currency. */
export const setRateRequestSchema = z.strictObject({
  unitCurrency: currencyCodeSchema,
  quoteCurrency: currencyCodeSchema,
  rate: exchangeRateValueSchema,
  /** The user confirmed a change beyond the threshold (rule 11). */
  confirmed: z.boolean().default(false),
});

export type SetRateRequest = z.input<typeof setRateRequestSchema>;

/**
 * The payload of `currency.rate.set`, version 1 (`core-money` *Offline and sync behavior*).
 * `effectiveAt` is the device's guarded time when the rate was set; `confirmed` is what the
 * device's screen obtained, carried for the audit and never refused for (rule 11).
 */
export const rateSetPayloadV1Schema = z.strictObject({
  rateId: syncIdSchema,
  unitCurrency: currencyCodeSchema,
  quoteCurrency: currencyCodeSchema,
  rate: exchangeRateValueSchema,
  effectiveAt: z.iso.datetime({ offset: true }),
  confirmed: z.boolean(),
});

export type RateSetPayloadV1 = z.infer<typeof rateSetPayloadV1Schema>;

/** A tenant's currency as devices pull it (`currency.tenantCurrency`), with its catalog fields. */
export const tenantCurrencySchema = z.object({
  code: currencyCodeSchema,
  minorUnits: z.int().min(0).max(6),
  strengthRank: z.int().min(0),
  enabled: z.boolean(),
  /** Canonical decimal text at the currency's minor unit, at most 1000 (rule 4). */
  cashRoundingStep: decimalString({ scale: 4, precision: 8, sign: "positive" }),
});

/** The tenant's currency settings as devices pull them (`currency.settings`). */
export const currencySettingsSchema = z.object({
  changeCurrency: currencyCodeSchema,
  rateChangeThresholdPercent: z.int().min(1).max(100),
});

/** A recorded rate on the wire: the route's answer and the row devices pull. */
export const exchangeRateSchema = z.object({
  id: syncIdSchema,
  unitCurrency: currencyCodeSchema,
  quoteCurrency: currencyCodeSchema,
  /** Canonical decimal text, at most 6 decimals and 12 whole digits (rule 7). */
  rate: exchangeRateValueSchema,
  effectiveAt: z.iso.datetime({ offset: true }),
  recordedAt: z.iso.datetime({ offset: true }),
  setBy: syncIdSchema,
  deviceId: syncIdSchema.nullable(),
  opId: syncIdSchema.nullable(),
});

export type ExchangeRateWire = z.infer<typeof exchangeRateSchema>;

/** The refusals and rejections of `core.currency`; clients map each code to an Arabic message. */
export const currencyProblemCodes = {
  /**
   * The pair is not the base and an enabled foreign currency quoted per 1 unit of the stronger
   * (rule 6).
   */
  invalidPair: "currency.rate.invalidPair",
  /** The rate moves beyond the threshold and the request did not confirm it (rule 11). */
  confirmationRequired: "currency.rate.confirmationRequired",
  /** A `currency.rate.set` operation whose payload is not a rate. */
  rateInvalid: "currency.rate.invalid",
  /** Another operation already recorded a rate with this id. */
  rateDuplicate: "currency.rate.duplicate",
  /** Currency settings that disable the base currency, which is always enabled (rule 2). */
  baseDisabled: "currency.settings.baseDisabled",
  /** Currency settings that leave the change currency disabled (rule 3). */
  changeCurrencyInUse: "currency.changeCurrency.inUse",
  /** A foreign currency enabled without a rate and without its first one (rule 2). */
  firstRateRequired: "currency.settings.firstRateRequired",
  /** A first rate for a currency that stays disabled or already has a rate. */
  firstRateUnexpected: "currency.settings.firstRateUnexpected",
} as const;

/** Why a pair cannot take a new rate (rule 6), if it cannot. */
export type RatePairProblem = "inverted" | "withoutBase" | "disabled";

/**
 * Whether a rate may be set for `unitCurrency`/`quoteCurrency` (rule 6): the pair names the base
 * and one foreign currency, quoted units of the weaker per 1 unit of the stronger (ADR-0031),
 * and the foreign one is enabled. `enabled` is the tenant's enabled currencies; leave it out to
 * check the pair alone (a device's rate for a currency disabled since is still recorded).
 */
export function ratePairProblem(
  base: BaseCurrencyCode,
  pair: { readonly unitCurrency: CurrencyCode; readonly quoteCurrency: CurrencyCode },
  enabled?: ReadonlySet<CurrencyCode>,
): RatePairProblem | undefined {
  const { unitCurrency, quoteCurrency } = pair;
  if (unitCurrency === quoteCurrency) return "withoutBase";
  const quoted = quotedPair(unitCurrency, quoteCurrency);
  if (quoted.unitCurrency !== unitCurrency) return "inverted";
  if (unitCurrency !== base && quoteCurrency !== base) return "withoutBase";
  const foreign = unitCurrency === base ? quoteCurrency : unitCurrency;
  if (enabled !== undefined && !enabled.has(foreign)) return "disabled";
  return undefined;
}

/** The change from `current` to `next`, in percent of `current`, to two decimals (rule 11). */
export function rateChangePercent(current: Decimal, next: Decimal): Decimal {
  return next.minus(current).times(Decimal.of("100")).dividedBy(current, 2, "halfAwayFromZero");
}

/**
 * Whether moving from `current` to `next` needs a confirmation (rule 11): it differs by more than
 * `thresholdPercent` of `current`, either way. Compared exactly, without rounding the percent.
 */
export function rateChangeNeedsConfirmation(
  current: Decimal,
  next: Decimal,
  thresholdPercent: number,
): boolean {
  return next
    .minus(current)
    .abs()
    .times(Decimal.of("100"))
    .greaterThan(current.times(Decimal.of(String(thresholdPercent))));
}
