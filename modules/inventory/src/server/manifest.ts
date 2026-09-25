import { fileURLToPath } from "node:url";
import { defineModule } from "@mustawfi/core-config/server";
import type { InventoryContext } from "./dependencies.ts";
import { inventoryRoutes } from "./routes.ts";

/** `inventory`: products; stock, units, and price levels come with the `inventory` unit. */
export const inventoryModule = defineModule<InventoryContext>({
  id: "inventory",
  dependsOn: ["core.access", "core.audit", "core.config", "core.tenancy"],
  migrations: fileURLToPath(new URL("../../migrations", import.meta.url)),
  routes: inventoryRoutes,
});
