import { fileURLToPath } from "node:url";
import { defineModule } from "@mustawfi/core-config/server";
import { CURRENCY_SETTINGS_PERMISSION, RATE_SET_PERMISSION } from "../shared/index.ts";
import { type CurrencyContext, currencyRoutes } from "./routes.ts";

/**
 * `core.currency`: the currency catalog (code), each tenant's currencies and settings, and the
 * append-only exchange rates (ADR-0031), set online through its route or on a device through its
 * sync operation (`currencySyncOperations`), and pulled by every device. Other modules read
 * rates and convert through it. Its screens: exchange rates, and the currency settings.
 */
export const currencyModule = defineModule<CurrencyContext>({
  id: "core.currency",
  dependsOn: ["core.access", "core.audit", "core.config", "core.sync", "core.tenancy"],
  permissions: [
    /** Checked by the route, and at ingest for the operation (a miss flags `permissionMissing`). */
    { id: RATE_SET_PERMISSION, grants: ["accountant"] },
    /** Enabling currencies, steps, change currency, threshold (rules 2–5); owners by default. */
    { id: CURRENCY_SETTINGS_PERMISSION, grants: [] },
  ],
  migrations: fileURLToPath(new URL("../../migrations", import.meta.url)),
  routes: currencyRoutes,
});
