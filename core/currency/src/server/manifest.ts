import { fileURLToPath } from "node:url";
import { defineModule } from "@mustawfi/core-config/server";

/**
 * `core.currency`: the currency catalog (code), each tenant's currencies and settings, and the
 * append-only exchange rates (ADR-0031). Other modules read rates and convert through it; the
 * rate-setting route, sync operation, and screens come later in `core-money`.
 */
export const currencyModule = defineModule({
  id: "core.currency",
  dependsOn: ["core.config", "core.tenancy"],
  migrations: fileURLToPath(new URL("../../migrations", import.meta.url)),
});
