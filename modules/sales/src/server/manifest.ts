import { fileURLToPath } from "node:url";
import { defineModule } from "@mustawfi/core-config/server";
import { INVOICE_DOC_CODE } from "../shared/index.ts";
import type { SalesContext } from "./dependencies.ts";
import { salesRoutes } from "./routes.ts";

/**
 * `sales`: invoices, recorded on the server when a device pushes them (ADR-0020). Its sync
 * operations are `salesSyncOperations`; the owner reads recorded invoices through its routes,
 * and devices sell through its `client` entry (the POS). Returns and payments come with the
 * `sales` unit.
 */
export const salesModule = defineModule<SalesContext>({
  id: "sales",
  dependsOn: [
    "core.access",
    "core.audit",
    "core.config",
    "core.ledger",
    "core.organization",
    "core.sync",
    "core.tenancy",
    "inventory",
  ],
  documentCodes: [INVOICE_DOC_CODE],
  migrations: fileURLToPath(new URL("../../migrations", import.meta.url)),
  routes: salesRoutes,
});
