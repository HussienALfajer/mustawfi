import { eq } from "drizzle-orm";
import { newTenantSchema, storeCodeSchema, type NewTenantInput } from "../shared/index.ts";
import { branches, tenants } from "./schema.ts";
import type { TenantTransaction } from "./tenant-database.ts";

export interface NewTenant extends NewTenantInput {
  /** Must be the `tenantId` of the `withTenant` context `tx` runs in; RLS refuses otherwise. */
  readonly tenantId: string;
  /** The id of the hidden default branch created with the tenant. */
  readonly branchId: string;
  /** A fresh store code (ADR-0029); a code another tenant holds fails the insert (`23505`). */
  readonly storeCode: string;
  readonly createdAt: Date;
  readonly createdBy: string;
}

export interface Tenant {
  readonly id: string;
  readonly name: string;
  readonly baseCurrency: string;
  readonly storeCode: string;
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
  const storeCode = storeCodeSchema.parse(tenant.storeCode);
  if (storeCode !== tenant.storeCode) {
    throw new TypeError(`"${tenant.storeCode}" is not a store code in its stored form`);
  }
  await tx.insert(tenants).values({
    id: tenantId,
    tenantId,
    branchId,
    createdAt,
    createdBy,
    name,
    baseCurrency,
    storeCode,
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
  return { id: tenantId, name, baseCurrency, storeCode, defaultBranchId: branchId };
}

/** The tenant of the current `withTenant` context. */
export async function currentTenant(tx: TenantTransaction): Promise<Tenant | undefined> {
  const [row] = await tx
    .select({
      id: tenants.id,
      name: tenants.name,
      baseCurrency: tenants.baseCurrency,
      storeCode: tenants.storeCode,
      defaultBranchId: branches.id,
    })
    .from(tenants)
    .innerJoin(branches, eq(branches.id, tenants.branchId));
  return row;
}
