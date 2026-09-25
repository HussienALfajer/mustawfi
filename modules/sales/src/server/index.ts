import type { SyncOperationDefinition } from "@mustawfi/core-sync/server";
import { invoicePostOperation } from "./invoices.ts";

export { INVOICE_SOURCE_TYPE, invoicePostOperation } from "./invoices.ts";
export type { SalesContext } from "./dependencies.ts";
export { listInvoices } from "./invoice-list.ts";
export { salesModule } from "./manifest.ts";

/** The sync operations `sales` handles; the host dispatches pushes to them while it is enabled. */
export const salesSyncOperations: readonly SyncOperationDefinition[] = [invoicePostOperation];
