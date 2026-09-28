import { apiRequest } from "@mustawfi/core-config/client";
import type { LocalDb } from "@mustawfi/local-db";
import { queryOptions } from "@tanstack/react-query";
import {
  baseCurrencySchema,
  DEFAULT_RATE_CHANGE_THRESHOLD_PERCENT,
  exchangeRateSchema,
  type ExchangeRateWire,
  type NamedExchangeRate,
  RATE_HISTORY_LIMIT,
  ratesOverviewSchema,
  type SetRateRequest,
} from "../../shared/index.ts";
import {
  LOCAL_CURRENCY_SETTINGS_TABLE,
  LOCAL_EXCHANGE_RATES_TABLE,
  LOCAL_TENANT_CURRENCIES_TABLE,
  listLocalCurrentRates,
  listLocalExchangeRates,
  listLocalTenantCurrencies,
  localCurrencySettingsOf,
  type LocalExchangeRate,
} from "../local-currency.ts";
import { enabledForeign, type RateLine, type RatesData } from "./rates.ts";

/** A rate held on this device, as the screen shows it. */
function localLine(rate: LocalExchangeRate, deviceId: string): RateLine {
  return {
    id: rate.id,
    unitCurrency: rate.unitCurrency,
    quoteCurrency: rate.quoteCurrency,
    rate: rate.rate,
    effectiveAt: rate.effectiveAt,
    setBy: rate.setBy,
    setByName: null,
    source:
      rate.deviceId === null ? "online" : rate.deviceId === deviceId ? "thisDevice" : "otherDevice",
    deviceName: null,
    pending: rate.recordedAt === null,
  };
}

/**
 * The rates screen's data on a registered device, from its own database (offline too): the
 * store's currencies, settings, and rates as last pulled, with the ones set here since.
 */
export async function localRatesData(
  db: LocalDb,
  device: { readonly deviceId: string; readonly baseCurrency: string },
): Promise<RatesData> {
  const baseCurrency = baseCurrencySchema.parse(device.baseCurrency);
  const line = (rate: LocalExchangeRate) => localLine(rate, device.deviceId);
  return {
    baseCurrency,
    foreign: enabledForeign(baseCurrency, await listLocalTenantCurrencies(db)),
    // Before the settings are pulled, the default threshold still guards a mistyped rate.
    thresholdPercent:
      (await localCurrencySettingsOf(db))?.rateChangeThresholdPercent ??
      DEFAULT_RATE_CHANGE_THRESHOLD_PERCENT,
    current: (await listLocalCurrentRates(db)).map(line),
    history: (await listLocalExchangeRates(db, RATE_HISTORY_LIMIT)).map(line),
  };
}

export const localRatesQueryKey = ["local", "currency", "rates"] as const;

/** The rates screen's data on this device; read again whenever a pull or a new rate commits. */
export function localRatesQueryOptions(
  db: LocalDb,
  device: { readonly deviceId: string; readonly baseCurrency: string },
) {
  return queryOptions({
    queryKey: [...localRatesQueryKey, device.deviceId, device.baseCurrency],
    queryFn: () => localRatesData(db, device),
    networkMode: "always",
    meta: {
      localTables: [
        LOCAL_EXCHANGE_RATES_TABLE,
        LOCAL_TENANT_CURRENCIES_TABLE,
        LOCAL_CURRENCY_SETTINGS_TABLE,
      ],
    },
  });
}

/** A rate the server named. */
function onlineLine(rate: NamedExchangeRate): RateLine {
  return {
    id: rate.id,
    unitCurrency: rate.unitCurrency,
    quoteCurrency: rate.quoteCurrency,
    rate: rate.rate,
    effectiveAt: rate.effectiveAt,
    setBy: rate.setBy,
    setByName: rate.setByName,
    source: rate.deviceId === null ? "online" : "otherDevice",
    deviceName: rate.deviceName,
    pending: false,
  };
}

const RATES = "/api/v1/currency/rates";

export const onlineRatesQueryKey = ["currency", "rates"] as const;

/** The rates screen's data from the server, for a client that is no registered device. */
export function onlineRatesQueryOptions() {
  return queryOptions({
    queryKey: onlineRatesQueryKey,
    queryFn: async ({ signal }): Promise<RatesData> => {
      const overview = await apiRequest(RATES, { schema: ratesOverviewSchema, signal });
      return {
        baseCurrency: overview.baseCurrency,
        foreign: enabledForeign(overview.baseCurrency, overview.currencies),
        thresholdPercent: overview.settings.rateChangeThresholdPercent,
        current: overview.current.map(onlineLine),
        history: overview.history.map(onlineLine),
      };
    },
  });
}

/** Sets a rate through the route (`POST /api/v1/currency/rates`), effective at the server's time. */
export function setOnlineRate(request: SetRateRequest): Promise<ExchangeRateWire> {
  return apiRequest(RATES, { method: "POST", body: request, schema: exchangeRateSchema });
}
