import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import { eq } from "drizzle-orm";
import { newOwnerSchema, type NewOwnerInput } from "../shared/index.ts";
import { users } from "./schema.ts";

export interface NewOwner extends NewOwnerInput {
  readonly id: string;
  readonly tenantId: string;
  readonly branchId: string;
  /** From `hashPassword`. */
  readonly passwordHash: string;
  readonly createdAt: Date;
  readonly createdBy: string;
}

/** Creates the tenant's owner in `tx`, a `withTenant` transaction for `tenantId`. */
export async function createOwner(tx: TenantTransaction, owner: NewOwner): Promise<void> {
  const { name, login } = newOwnerSchema.parse(owner);
  if (!owner.passwordHash.startsWith("$argon2id$")) {
    throw new TypeError("passwordHash must be an Argon2id hash from hashPassword");
  }
  await tx.insert(users).values({
    id: owner.id,
    tenantId: owner.tenantId,
    branchId: owner.branchId,
    createdAt: owner.createdAt,
    createdBy: owner.createdBy,
    name,
    login,
    passwordHash: owner.passwordHash,
    isOwner: true,
  });
}

/**
 * Whether `userId` is a user of the current `withTenant` context's tenant. Sync checks the
 * user each operation names before recording it (ADR-0022).
 */
export async function isTenantUser(tx: TenantTransaction, userId: string): Promise<boolean> {
  const rows = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
  return rows.length > 0;
}
