import { fileURLToPath } from "node:url";
import { defineModule } from "@mustawfi/core-config/server";
import { RATE_SET_PERMISSION } from "../shared/index.ts";
import { type CurrencyContext, currencyRoutes } from "./routes.ts";

/**
 * `core.currency`: the currency catalog (code), each tenant's currencies and settings, and the
 * append-only exchange rates (ADR-0031), set online through its route or on a device through its
 * sync operation (`currencySyncOperations`), and pulled by every device. Other modules read
 * rates and convert through it; the currency screens come later in `core-money`.
 */
export const currencyModule = defineModule<CurrencyContext>({
  id: "core.currency",
  dependsOn: ["core.access", "core.audit", "core.config", "core.sync", "core.tenancy"],
  permissions: [
    /** Checked by the route, and at ingest for the operation (a miss flags `permissionMissing`). */
    { id: RATE_SET_PERMISSION, grants: ["accountant"] },
  ],
  migrations: fileURLToPath(new URL("../../migrations", import.meta.url)),
  routes: currencyRoutes,
});
