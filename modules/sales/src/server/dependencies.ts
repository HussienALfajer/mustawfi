import type { TenantDatabase } from "@mustawfi/core-tenancy/server";
import type { Clock } from "@mustawfi/kernel";

/** The part of the host context `sales` routes use. */
export interface SalesContext {
  readonly tenants: TenantDatabase;
  readonly clock: Clock;
}
