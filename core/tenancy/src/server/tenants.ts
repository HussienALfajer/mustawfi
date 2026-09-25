import { eq } from "drizzle-orm";
import {
  DEFAULT_DEPARTMENT_NAME,
  newTenantSchema,
  storeCodeSchema,
  type NewTenantInput,
} from "../shared/index.ts";
import { insertDefaultDepartment } from "./departments.ts";
import { branches, tenants } from "./schema.ts";
import type { TenantTransaction } from "./tenant-database.ts";

export interface NewTenant extends NewTenantInput {
  /** Must be the `tenantId` of the `withTenant` context `tx` runs in; RLS refuses otherwise. */
  readonly tenantId: string;
  /** The id of the hidden default branch created with the tenant. */
  readonly branchId: string;
  /** The id of the default department created with the tenant («المتجر», rule 28). */
  readonly defaultDepartmentId: string;
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

export interface CreatedTenant extends Tenant {
  readonly defaultDepartmentId: string;
}

/**
 * Creates a tenant, its hidden default branch, and its default department in `tx`, a `withTenant` transaction for the
 * new tenant's id. The caller adds what else a new tenant needs (its owner, its accounts) in
 * the same transaction.
 */
export async function createTenant(
  tx: TenantTransaction,
  tenant: NewTenant,
): Promise<CreatedTenant> {
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
  await insertDefaultDepartment(tx, {
    id: tenant.defaultDepartmentId,
    tenantId,
    branchId,
    name: DEFAULT_DEPARTMENT_NAME,
    createdAt,
    createdBy,
  });
  return {
    id: tenantId,
    name,
    baseCurrency,
    storeCode,
    defaultBranchId: branchId,
    defaultDepartmentId: tenant.defaultDepartmentId,
  };
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
