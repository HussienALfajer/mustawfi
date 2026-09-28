import { Decimal, decimalString } from "@mustawfi/kernel";
import { z } from "zod";
import {
  baseCurrencySchema,
  CURRENCY_CODES,
  currencyCodeSchema,
  exchangeRateValueSchema,
  isValidCashRoundingStep,
} from "./catalog.ts";
import { currencySettingsSchema, exchangeRateSchema, tenantCurrencySchema } from "./rates.ts";

/** Enabling currencies, their cash-rounding steps, the change currency, the threshold (rules 2–5). */
export const CURRENCY_SETTINGS_PERMISSION = "currency.settings.manage";

/**
 * A cash-rounding step as typed: positive decimal text with at most four decimals and 1000 at
 * most; whether it fits its currency's minor unit (rule 4) is checked with the currency.
 */
const cashRoundingStepSchema = decimalString({ scale: 4, precision: 8, sign: "positive" });

/**
 * `PUT /api/v1/currency/settings`: the whole currency settings at once — every catalog currency
 * once with whether it is enabled and its cash-rounding step, the change currency, the
 * threshold — plus the first rate of each foreign currency enabled without one (rule 2),
 * quoted the ADR-0031 way against the base. Rules 4 and 5 are checked here (400); rules 2–3
 * by the route, against the tenant's base and rates.
 */
export const saveCurrencySettingsRequestSchema = z
  .strictObject({
    currencies: z
      .array(
        z.strictObject({
          code: currencyCodeSchema,
          enabled: z.boolean(),
          cashRoundingStep: cashRoundingStepSchema,
        }),
      )
      .length(CURRENCY_CODES.length),
    changeCurrency: currencyCodeSchema,
    rateChangeThresholdPercent: z.int().min(1).max(100),
    firstRates: z
      .array(z.strictObject({ currency: currencyCodeSchema, rate: exchangeRateValueSchema }))
      .max(CURRENCY_CODES.length)
      .default([]),
  })
  .superRefine((request, context) => {
    const codes = new Set(request.currencies.map((currency) => currency.code));
    if (codes.size !== CURRENCY_CODES.length) {
      context.addIssue({ code: "custom", message: "every currency once", path: ["currencies"] });
    }
    request.currencies.forEach((currency, i) => {
      if (!isValidCashRoundingStep(currency.code, Decimal.of(currency.cashRoundingStep))) {
        context.addIssue({
          code: "custom",
          message: "a multiple of the minor unit, at most 1000",
          path: ["currencies", i, "cashRoundingStep"],
        });
      }
    });
    const rated = new Set(request.firstRates.map((first) => first.currency));
    if (rated.size !== request.firstRates.length) {
      context.addIssue({ code: "custom", message: "one first rate each", path: ["firstRates"] });
    }
  });

export type SaveCurrencySettingsRequest = z.input<typeof saveCurrencySettingsRequestSchema>;

/**
 * The currency settings screen's data (`GET` and `PUT /api/v1/currency/settings`): the tenant's
 * base, its currencies, its settings, and which foreign currencies already have a rate — those
 * are enabled without asking for a first one.
 */
export const currencySettingsOverviewSchema = z.object({
  baseCurrency: baseCurrencySchema,
  currencies: z.array(tenantCurrencySchema),
  settings: currencySettingsSchema,
  ratedCurrencies: z.array(currencyCodeSchema),
});

export type CurrencySettingsOverview = z.infer<typeof currencySettingsOverviewSchema>;

/** A rate as the rates screen lists it online: with who set it and on which device, by name. */
export const namedExchangeRateSchema = exchangeRateSchema.extend({
  setByName: z.string().nullable(),
  deviceName: z.string().nullable(),
});

export type NamedExchangeRate = z.infer<typeof namedExchangeRateSchema>;

/** How many recent rates the rates screen lists. */
export const RATE_HISTORY_LIMIT = 30;

/**
 * The rates screen's data for a client that is no registered device (`GET
 * /api/v1/currency/rates`): what a device reads from its own database, from the server.
 */
export const ratesOverviewSchema = z.object({
  baseCurrency: baseCurrencySchema,
  currencies: z.array(tenantCurrencySchema),
  settings: currencySettingsSchema,
  current: z.array(namedExchangeRateSchema),
  history: z.array(namedExchangeRateSchema),
});

export type RatesOverview = z.infer<typeof ratesOverviewSchema>;
