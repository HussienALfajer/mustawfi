import { accessBundlePart, accessModule, type TotpKeyRing } from "@mustawfi/core-access/server";
import { auditModule } from "@mustawfi/core-audit/server";
import type { PermissionCatalogue } from "@mustawfi/core-config/shared";
import {
  type BundlePart,
  type BundleSigningKey,
  configModule,
  createModuleRegistry,
  type ModuleManifest,
  type ModuleRegistry,
} from "@mustawfi/core-config/server";
import { ledgerModule } from "@mustawfi/core-ledger/server";
import { organizationBundlePart, organizationModule } from "@mustawfi/core-organization/server";
import {
  createSyncOperationTable,
  deviceAuditOperation,
  syncModule,
  type SyncOperationDefinition,
  type SyncOperationTable,
} from "@mustawfi/core-sync/server";
import {
  licenseBundlePart,
  tenancyModule,
  type TenantDatabase,
  type TenantTransaction,
} from "@mustawfi/core-tenancy/server";
import { TENANCY_DEVICE_AUDIT_ACTIONS } from "@mustawfi/core-tenancy/shared";
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
  /** The key that signs configuration bundles, from `BUNDLE_KEY_FILE` (ADR-0021). */
  readonly bundleKey: BundleSigningKey;
  /** The configuration bundle's parts of the enabled modules (`hostBundleParts`). */
  readonly bundleParts: readonly BundlePart<TenantTransaction>[];
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
 * The actions each module's devices audit through the device audit path (`audit.entry.record`,
 * `core-foundation` rule 33), by module id.
 */
export const moduleDeviceAuditActions: Readonly<Record<string, readonly string[]>> = {
  "core.tenancy": TENANCY_DEVICE_AUDIT_ACTIONS,
};

/**
 * The operation table push dispatches through: the operations of the registry's enabled
 * modules only, so a disabled module's operations are rejected as unsupported — and
 * `core.sync`'s device audit events, accepted for the actions the enabled modules declare.
 */
export function hostSyncOperations(registry: ModuleRegistry<HostContext>): SyncOperationTable {
  const enabled = registry.enabled.map((module) => module.id);
  const deviceAuditActions = new Set(enabled.flatMap((id) => moduleDeviceAuditActions[id] ?? []));
  return createSyncOperationTable(
    [
      ...(enabled.includes(syncModule.id) ? [deviceAuditOperation(deviceAuditActions)] : []),
      ...enabled.flatMap((id) => moduleSyncOperations[id] ?? []),
    ],
    registry.permissions,
  );
}

/**
 * The parts each module contributes to the configuration bundle (ADR-0030), by module id; the
 * access part resolves roles against the registry's permissions.
 */
function moduleBundleParts(
  registry: ModuleRegistry<HostContext>,
): Readonly<Record<string, readonly BundlePart<TenantTransaction>[]>> {
  return {
    "core.tenancy": [licenseBundlePart],
    "core.access": [accessBundlePart(registry.permissions)],
    "core.organization": [organizationBundlePart],
  };
}

/** The bundle's parts: those of the registry's enabled modules, each name once. */
export function hostBundleParts(
  registry: ModuleRegistry<HostContext>,
): readonly BundlePart<TenantTransaction>[] {
  const byModule = moduleBundleParts(registry);
  const parts = registry.enabled.flatMap((module) => byModule[module.id] ?? []);
  const names = new Set<string>();
  for (const part of parts) {
    if (names.has(part.name))
      throw new Error(`two modules contribute the bundle part ${part.name}`);
    names.add(part.name);
  }
  return parts;
}

/**
 * The context every module's routes receive, from the registry and the host's services: the
 * sync operations and bundle parts of its enabled modules and the permissions of all its
 * modules.
 */
export function hostContext(
  registry: ModuleRegistry<HostContext>,
  services: Omit<HostContext, "syncOperations" | "permissionCatalogue" | "bundleParts">,
): HostContext {
  return {
    ...services,
    syncOperations: hostSyncOperations(registry),
    permissionCatalogue: registry.permissions,
    bundleParts: hostBundleParts(registry),
  };
}

let permissions: PermissionCatalogue | undefined;

/** The permissions and limits of every module this server runs, disabled or not. */
export function serverPermissions(): PermissionCatalogue {
  permissions ??= createServerRegistry().permissions;
  return permissions;
}
