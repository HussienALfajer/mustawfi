import { eq } from "drizzle-orm";
import { newTenantSchema, type NewTenantInput } from "../shared/index.ts";
import { branches, tenants } from "./schema.ts";
import type { TenantTransaction } from "./tenant-database.ts";

export interface NewTenant extends NewTenantInput {
  /** Must be the `tenantId` of the `withTenant` context `tx` runs in; RLS refuses otherwise. */
  readonly tenantId: string;
  /** The id of the hidden default branch created with the tenant. */
  readonly branchId: string;
  readonly createdAt: Date;
  readonly createdBy: string;
}

export interface Tenant {
  readonly id: string;
  readonly name: string;
  readonly baseCurrency: string;
  readonly defaultBranchId: string;
}

/**
 * Creates a tenant and its hidden default branch in `tx`, a `withTenant` transaction for the
 * new tenant's id. The caller adds what else a new tenant needs (its owner, its accounts) in
 * the same transaction.
 */
export async function createTenant(tx: TenantTransaction, tenant: NewTenant): Promise<Tenant> {
  const { name, baseCurrency } = newTenantSchema.parse(tenant);
  const { tenantId, branchId, createdAt, createdBy } = tenant;
  await tx.insert(tenants).values({
    id: tenantId,
    tenantId,
    branchId,
    createdAt,
    createdBy,
    name,
    baseCurrency,
  });
  await tx.insert(branches).values({
    id: branchId,
    tenantId,
    branchId,
    createdAt,
    createdBy,
    name,
    isDefault: true,
  });
  return { id: tenantId, name, baseCurrency, defaultBranchId: branchId };
}

/** The tenant of the current `withTenant` context. */
export async function currentTenant(tx: TenantTransaction): Promise<Tenant | undefined> {
  const [row] = await tx
    .select({
      id: tenants.id,
      name: tenants.name,
      baseCurrency: tenants.baseCurrency,
      defaultBranchId: branches.id,
    })
    .from(tenants)
    .innerJoin(branches, eq(branches.id, tenants.branchId));
  return row;
}
