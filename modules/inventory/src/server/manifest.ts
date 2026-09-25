import { fileURLToPath } from "node:url";
import { defineModule } from "@mustawfi/core-config/server";
import type { InventoryContext } from "./dependencies.ts";
import { inventoryRoutes } from "./routes.ts";

/**
 * `inventory`: products, which flow down to devices, and stock on hand with its movements; units,
 * price levels, and stock screens come with the `inventory` unit.
 */
export const inventoryModule = defineModule<InventoryContext>({
  id: "inventory",
  dependsOn: ["core.access", "core.audit", "core.config", "core.sync", "core.tenancy"],
  permissions: [
    {
      id: "inventory.products.view",
      grants: ["accountant", "sectionCashier", "repairTechnician", "topUpOperator"],
    },
    { id: "inventory.products.manage", grants: ["accountant"] },
  ],
  migrations: fileURLToPath(new URL("../../migrations", import.meta.url)),
  routes: inventoryRoutes,
});
