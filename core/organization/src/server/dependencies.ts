import type { TenantDatabase } from "@mustawfi/core-tenancy/server";
import type { Clock, IdGenerator } from "@mustawfi/kernel";

/** The part of the host context `core.organization` routes use. */
export interface OrganizationContext {
  readonly tenants: TenantDatabase;
  readonly clock: Clock;
  readonly newId: IdGenerator;
}
