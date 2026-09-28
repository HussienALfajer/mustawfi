import { parseDecimalInput } from "@mustawfi/i18n";
import { Decimal } from "@mustawfi/kernel";
import {
  type CurrencyCode,
  type CurrencySettingsOverview,
  exchangeRateValueSchema,
  isValidCashRoundingStep,
  type SaveCurrencySettingsRequest,
  saveCurrencySettingsRequestSchema,
} from "../../shared/index.ts";

/** One currency as the settings form holds it: text as typed. */
export interface CurrencyValues {
  readonly code: CurrencyCode;
  readonly enabled: boolean;
  readonly cashRoundingStep: string;
  /** The first rate, for an enabled foreign currency without one (rule 2). */
  readonly firstRate: string;
}

export interface SettingsValues {
  readonly currencies: readonly CurrencyValues[];
  readonly changeCurrency: CurrencyCode;
  readonly threshold: string;
}

/** A field's problem, a key under `settings.problem.`. */
export type SettingsErrors = Readonly<Record<string, string>>;

/** The form's field of one currency's step or first rate, as `SettingsErrors` names it. */
export const fieldOf = {
  step: (code: CurrencyCode) => `currencies.${code}.cashRoundingStep`,
  firstRate: (code: CurrencyCode) => `currencies.${code}.firstRate`,
  enabled: (code: CurrencyCode) => `currencies.${code}.enabled`,
  changeCurrency: "changeCurrency",
  threshold: "threshold",
} as const;

/** The form's values for the settings as the server holds them. */
export function settingsValues(overview: CurrencySettingsOverview): SettingsValues {
  return {
    currencies: overview.currencies.map((currency) => ({
      code: currency.code,
      enabled: currency.enabled,
      cashRoundingStep: Decimal.of(currency.cashRoundingStep).toString(),
      firstRate: "",
    })),
    changeCurrency: overview.settings.changeCurrency,
    threshold: String(overview.settings.rateChangeThresholdPercent),
  };
}

/** Whether a foreign currency is enabled without a rate, so the form offers its first one. */
export function needsFirstRate(
  overview: CurrencySettingsOverview,
  currency: Pick<CurrencyValues, "code" | "enabled">,
): boolean {
  return (
    currency.enabled &&
    currency.code !== overview.baseCurrency &&
    !overview.ratedCurrencies.includes(currency.code)
  );
}

/**
 * The request for `values`, or the problem of each field that stops it: the checks of the
 * server's schema (rules 4–5, `saveCurrencySettingsRequestSchema`) and of its route (rules 2–3),
 * said on their fields before anything is sent.
 */
export function readSettings(
  overview: CurrencySettingsOverview,
  values: SettingsValues,
):
  | { readonly request: SaveCurrencySettingsRequest; readonly errors?: undefined }
  | { readonly request?: undefined; readonly errors: SettingsErrors } {
  const errors: Record<string, string> = {};
  const wasEnabled = new Set(overview.currencies.filter((c) => c.enabled).map((c) => c.code));
  const currencies = values.currencies.map((currency) => {
    const step = parseDecimalInput(currency.cashRoundingStep);
    if (step === undefined || !isValidCashRoundingStep(currency.code, Decimal.of(step))) {
      errors[fieldOf.step(currency.code)] = "stepInvalid";
    }
    return {
      code: currency.code,
      enabled: currency.code === overview.baseCurrency || currency.enabled,
      cashRoundingStep: step ?? currency.cashRoundingStep,
    };
  });
  const firstRates = values.currencies.flatMap((currency) => {
    if (!needsFirstRate(overview, currency)) return [];
    const text = currency.firstRate.trim();
    if (text === "") {
      if (!wasEnabled.has(currency.code)) {
        errors[fieldOf.firstRate(currency.code)] = "firstRateRequired";
      }
      return [];
    }
    const rate = exchangeRateValueSchema.safeParse(parseDecimalInput(text) ?? "");
    if (!rate.success) {
      errors[fieldOf.firstRate(currency.code)] = "rateInvalid";
      return [];
    }
    return [{ currency: currency.code, rate: rate.data }];
  });
  const enabled = new Set(currencies.filter((c) => c.enabled).map((c) => c.code));
  if (!enabled.has(values.changeCurrency)) {
    errors[fieldOf.changeCurrency] = "changeCurrencyDisabled";
  }
  // A whole percent (rule 5): digits only, so the integer read from them is exact.
  const thresholdText = values.threshold.trim();
  const threshold = /^\d{1,3}$/.test(thresholdText) ? Number.parseInt(thresholdText, 10) : 0;
  if (threshold < 1 || threshold > 100) errors[fieldOf.threshold] = "thresholdInvalid";
  if (Object.keys(errors).length > 0) return { errors };
  const request = {
    currencies,
    changeCurrency: values.changeCurrency,
    rateChangeThresholdPercent: threshold,
    firstRates,
  };
  // The server's own schema, once more: what passes here passes there.
  const parsed = saveCurrencySettingsRequestSchema.safeParse(request);
  return parsed.success ? { request } : { errors: { form: "invalid" } };
}

/** Whether `values` differ from what the server holds. */
export function settingsDirty(overview: CurrencySettingsOverview, values: SettingsValues): boolean {
  return JSON.stringify(settingsValues(overview)) !== JSON.stringify(values);
}
