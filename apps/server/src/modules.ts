import { accessModule, type TotpKeyRing } from "@mustawfi/core-access/server";
import { auditModule } from "@mustawfi/core-audit/server";
import type { PermissionCatalogue } from "@mustawfi/core-config/shared";
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
  /** The keys sealing users' TOTP secrets, from `TOTP_KEYS_FILE` (`core-foundation` rule 26). */
  readonly totpKeys: TotpKeyRing;
  /** The sync operations of the enabled modules (`hostSyncOperations`). */
  readonly syncOperations: SyncOperationTable;
  /** Every permission and limit the registered modules declare (`registry.permissions`). */
  readonly permissionCatalogue: PermissionCatalogue;
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
    registry.permissions,
  );
}

/**
 * The context every module's routes receive, from the registry and the host's services: the
 * sync operations of its enabled modules and the permissions of all its modules.
 */
export function hostContext(
  registry: ModuleRegistry<HostContext>,
  services: Omit<HostContext, "syncOperations" | "permissionCatalogue">,
): HostContext {
  return {
    ...services,
    syncOperations: hostSyncOperations(registry),
    permissionCatalogue: registry.permissions,
  };
}

let permissions: PermissionCatalogue | undefined;

/** The permissions and limits of every module this server runs, disabled or not. */
export function serverPermissions(): PermissionCatalogue {
  permissions ??= createServerRegistry().permissions;
  return permissions;
}
