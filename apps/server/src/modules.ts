import { accessModule } from "@mustawfi/core-access/server";
import { auditModule } from "@mustawfi/core-audit/server";
import {
  configModule,
  createModuleRegistry,
  type ModuleManifest,
  type ModuleRegistry,
} from "@mustawfi/core-config/server";
import { ledgerModule } from "@mustawfi/core-ledger/server";
import { organizationModule } from "@mustawfi/core-organization/server";
import {
  createSyncOperationTable,
  syncModule,
  type SyncOperationDefinition,
  type SyncOperationTable,
} from "@mustawfi/core-sync/server";
import { tenancyModule, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import { inventoryModule } from "@mustawfi/inventory/server";
import type { Clock, IdGenerator, RandomSource } from "@mustawfi/kernel";
import { salesModule, salesSyncOperations } from "@mustawfi/sales/server";

/** What the host hands every module's routes. */
export interface HostContext {
  readonly tenants: TenantDatabase;
  readonly clock: Clock;
  readonly newId: IdGenerator;
  /** Randomness for secrets: session tokens, device credentials, codes. */
  readonly random: RandomSource;
  /** The sync operations of the enabled modules (`hostSyncOperations`). */
  readonly syncOperations: SyncOperationTable;
}

/** Every module this server runs. A module missing here fails `modules.test.ts`. */
export const serverModules: readonly ModuleManifest<HostContext>[] = [
  configModule,
  tenancyModule,
  auditModule,
  accessModule,
  ledgerModule,
  syncModule,
  organizationModule,
  inventoryModule,
  salesModule,
];

/** The sync operations each module handles, by module id. */
export const moduleSyncOperations: Readonly<Record<string, readonly SyncOperationDefinition[]>> = {
  sales: salesSyncOperations,
};

export function createServerRegistry(
  disabled: readonly string[] = [],
): ModuleRegistry<HostContext> {
  return createModuleRegistry(serverModules, { disabled });
}

/**
 * The operation table push dispatches through: the operations of the registry's enabled
 * modules only, so a disabled module's operations are rejected as unsupported.
 */
export function hostSyncOperations(registry: ModuleRegistry<HostContext>): SyncOperationTable {
  return createSyncOperationTable(
    registry.enabled.flatMap((module) => moduleSyncOperations[module.id] ?? []),
  );
}
