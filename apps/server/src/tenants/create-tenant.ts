import { loginSchema, passwordSchema, userNameSchema } from "@mustawfi/core-access/shared";
import { createOwner, hashPassword } from "@mustawfi/core-access/server";
import { currencyCodeSchema, tenantNameSchema } from "@mustawfi/core-tenancy/shared";
import { createTenant, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import type { Clock, IdGenerator } from "@mustawfi/kernel";
import { z } from "zod";

export const createTenantInputSchema = z.object({
  name: tenantNameSchema,
  baseCurrency: currencyCodeSchema,
  ownerName: userNameSchema,
  ownerLogin: loginSchema,
  ownerPassword: passwordSchema,
});

export type CreateTenantInput = z.input<typeof createTenantInputSchema>;

export interface CreatedTenant {
  readonly tenantId: string;
  readonly branchId: string;
  readonly ownerId: string;
}

/**
 * Flow 1 of the walking skeleton: a tenant, its hidden default branch, its base currency, and
 * its owner, in one `withTenant` transaction for the new tenant — all or nothing. Runs as
 * `mustawfi_app` under RLS like every other write. Seeded accounts join in slice 7.
 */
export async function createTenantWithOwner(
  tenants: TenantDatabase,
  input: CreateTenantInput,
  dependencies: { readonly clock: Clock; readonly newId: IdGenerator },
): Promise<CreatedTenant> {
  const parsed = createTenantInputSchema.parse(input);
  const passwordHash = await hashPassword(parsed.ownerPassword);
  const created: CreatedTenant = {
    tenantId: dependencies.newId(),
    branchId: dependencies.newId(),
    ownerId: dependencies.newId(),
  };
  const createdAt = dependencies.clock.now();
  const createdBy = created.ownerId;

  await tenants.withTenant({ tenantId: created.tenantId, userId: created.ownerId }, async (tx) => {
    await createTenant(tx, {
      tenantId: created.tenantId,
      branchId: created.branchId,
      name: parsed.name,
      baseCurrency: parsed.baseCurrency,
      createdAt,
      createdBy,
    });
    await createOwner(tx, {
      id: created.ownerId,
      tenantId: created.tenantId,
      branchId: created.branchId,
      name: parsed.ownerName,
      login: parsed.ownerLogin,
      passwordHash,
      createdAt,
      createdBy,
    });
  });
  return created;
}
