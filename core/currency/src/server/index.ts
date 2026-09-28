import type { SyncOperationDefinition } from "@mustawfi/core-sync/server";
import { rateSetOperation } from "./rate-operation.ts";

export {
  type CurrencySeed,
  listTenantCurrencies,
  readCurrencySettings,
  type SeededCurrencies,
  seedCurrencies,
} from "./currencies.ts";
export { currencyModule } from "./manifest.ts";
export { rateSetOperation } from "./rate-operation.ts";
export {
  appendExchangeRate,
  currentExchangeRate,
  currentExchangeRates,
  type ExchangeRateRecord,
  exchangeRateWire,
  listExchangeRates,
  type OnlineRate,
  type RateActor,
  type RecordedRate,
  recordExchangeRate,
  setExchangeRate,
} from "./rates.ts";
export type { CurrencyContext } from "./routes.ts";

/** The sync operations `core.currency` handles; the host dispatches pushes to them. */
export const currencySyncOperations: readonly SyncOperationDefinition[] = [rateSetOperation];
