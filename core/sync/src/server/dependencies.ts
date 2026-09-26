import type { BundlePart, BundleSigningKey } from "@mustawfi/core-config/server";
import type { TenantDatabase, TenantTransaction } from "@mustawfi/core-tenancy/server";
import type { Clock, IdGenerator } from "@mustawfi/kernel";
import type { SyncOperationTable } from "./operations.ts";

/** The part of the host context `core.sync` routes use. */
export interface SyncContext {
  readonly tenants: TenantDatabase;
  readonly clock: Clock;
  readonly newId: IdGenerator;
  /** The operation types of the enabled modules, which push dispatches to. */
  readonly syncOperations: SyncOperationTable;
  /** The key that signs configuration bundles, from `BUNDLE_KEY_FILE` (ADR-0021). */
  readonly bundleKey: BundleSigningKey;
  /** The configuration bundle's parts, from the enabled modules (ADR-0030). */
  readonly bundleParts: readonly BundlePart<TenantTransaction>[];
}
