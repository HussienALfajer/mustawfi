import { apiRequest } from "@mustawfi/core-config/client";
import { queryOptions } from "@tanstack/react-query";
import {
  type CurrencySettingsOverview,
  currencySettingsOverviewSchema,
  type SaveCurrencySettingsRequest,
} from "../../shared/index.ts";

const SETTINGS = "/api/v1/currency/settings";

export const currencySettingsQueryKey = ["currency", "settings"] as const;

/** The currency settings as the server holds them (online only). */
export function currencySettingsQueryOptions() {
  return queryOptions({
    queryKey: currencySettingsQueryKey,
    queryFn: ({ signal }) =>
      apiRequest(SETTINGS, { schema: currencySettingsOverviewSchema, signal }),
  });
}

/** Saves the whole currency settings (`PUT /api/v1/currency/settings`, rules 2–5). */
export function saveCurrencySettings(
  request: SaveCurrencySettingsRequest,
): Promise<CurrencySettingsOverview> {
  return apiRequest(SETTINGS, {
    method: "PUT",
    body: request,
    schema: currencySettingsOverviewSchema,
  });
}
