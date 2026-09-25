import type { PermissionCatalogue } from "@mustawfi/core-config/shared";
import type { TenantDatabase } from "@mustawfi/core-tenancy/server";
import type { Clock, IdGenerator, RandomSource } from "@mustawfi/kernel";

/** What `core.access` takes from the host: the time, new ids, and randomness for secrets. */
export interface AccessDependencies {
  readonly clock: Clock;
  readonly newId: IdGenerator;
  readonly random: RandomSource;
}

/** The part of the host context `core.access` routes use. */
export interface AccessContext extends AccessDependencies {
  readonly tenants: TenantDatabase;
  /** Every permission and limit the server's modules declare (`ModuleRegistry.permissions`). */
  readonly permissionCatalogue: PermissionCatalogue;
}
