import { defaultDepartment, type TenantTransaction } from "@mustawfi/core-tenancy/server";
import type { StoreProfileView } from "../shared/index.ts";
import { type Actor, type OrganizationDependencies, publishDepartment } from "./departments.ts";
import { createStoreProfile } from "./store-profile.ts";

/**
 * What `core.organization` adds to a new tenant, in its first transaction, after
 * `createTenant`: the store profile named after the store, and the default department that
 * `createTenant` wrote, both audited and published for devices to pull.
 */
export async function seedOrganization(
  tx: TenantTransaction,
  actor: Actor,
  storeName: string,
  dependencies: OrganizationDependencies,
): Promise<StoreProfileView> {
  const department = await defaultDepartment(tx);
  await publishDepartment(tx, actor, "created", { after: department }, dependencies);
  return createStoreProfile(tx, actor, storeName, dependencies);
}
