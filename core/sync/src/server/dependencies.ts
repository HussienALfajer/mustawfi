import type { TenantDatabase } from "@mustawfi/core-tenancy/server";
import type { Clock, IdGenerator } from "@mustawfi/kernel";
import type { SyncOperationTable } from "./operations.ts";

/** The part of the host context `core.sync` routes use. */
export interface SyncContext {
  readonly tenants: TenantDatabase;
  readonly clock: Clock;
  readonly newId: IdGenerator;
  /** The operation types of the enabled modules, which push dispatches to. */
  readonly syncOperations: SyncOperationTable;
}
