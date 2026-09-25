import { fileURLToPath } from "node:url";
import { defineModule } from "@mustawfi/core-config/server";

/**
 * `sales`: invoices, recorded on the server when a device pushes them (ADR-0020). Its sync
 * operations are `salesSyncOperations`; the POS screens, returns, and payments come with the
 * `sales` unit.
 */
export const salesModule = defineModule({
  id: "sales",
  dependsOn: [
    "core.access",
    "core.audit",
    "core.config",
    "core.ledger",
    "core.sync",
    "core.tenancy",
    "inventory",
  ],
  migrations: fileURLToPath(new URL("../../migrations", import.meta.url)),
});
