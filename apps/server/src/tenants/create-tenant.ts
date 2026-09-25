import { loginSchema, passwordSchema, userNameSchema } from "@mustawfi/core-access/shared";
import { createOwner, hashPassword } from "@mustawfi/core-access/server";
import { recordAudit } from "@mustawfi/core-audit/server";
import {
  currencyCodeSchema,
  STORE_CODE_LENGTH,
  tenantNameSchema,
} from "@mustawfi/core-tenancy/shared";
import {
  createTenant,
  type TenantDatabase,
  type TenantTransaction,
} from "@mustawfi/core-tenancy/server";
import { randomCode, type Clock, type IdGenerator, type RandomSource } from "@mustawfi/kernel";
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
  /** What the owner types to sign in (ADR-0029). */
  readonly storeCode: string;
}

export interface CreateTenantDependencies {
  readonly clock: Clock;
  readonly newId: IdGenerator;
  readonly random: RandomSource;
}

/** Draws of a store code before giving up; a clash is one in a hundred thousand at most. */
const STORE_CODE_ATTEMPTS = 5;

/** Whether `error` is a unique violation of a store-code constraint. */
function isStoreCodeTaken(error: unknown): boolean {
  for (let e = error; e instanceof Error; e = e.cause) {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown };
    if (code === "23505" && typeof constraint === "string") {
      return constraint === "store_codes_pkey" || constraint === "tenants_storeCode_unique";
    }
  }
  return false;
}

/**
 * Flow 1 of the walking skeleton: a tenant, its hidden default branch, its base currency, its
 * store code, and its owner, in one `withTenant` transaction for the new tenant — all or
 * nothing, and audited in the same transaction. Runs as `mustawfi_app` under RLS like every
 * other write. A store code another tenant already holds is drawn again. Seeded accounts join
 * in slice 7.
 */
export async function createTenantWithOwner(
  tenants: TenantDatabase,
  input: CreateTenantInput,
  dependencies: CreateTenantDependencies,
): Promise<CreatedTenant> {
  const parsed = createTenantInputSchema.parse(input);
  const passwordHash = await hashPassword(parsed.ownerPassword);
  const ids = {
    tenantId: dependencies.newId(),
    branchId: dependencies.newId(),
    ownerId: dependencies.newId(),
  };
  const createdAt = dependencies.clock.now();
  const createdBy = ids.ownerId;

  for (let attempt = 1; ; attempt += 1) {
    const created: CreatedTenant = {
      ...ids,
      storeCode: randomCode(dependencies.random, STORE_CODE_LENGTH),
    };
    try {
      await tenants.withTenant({ tenantId: created.tenantId, userId: created.ownerId }, (tx) =>
        writeTenant(tx, created),
      );
      return created;
    } catch (error) {
      if (attempt < STORE_CODE_ATTEMPTS && isStoreCodeTaken(error)) continue;
      throw error;
    }
  }

  async function writeTenant(tx: TenantTransaction, created: CreatedTenant): Promise<void> {
    const audit = { tenantId: created.tenantId, branchId: created.branchId, occurredAt: createdAt };
    const tenant = await createTenant(tx, {
      tenantId: created.tenantId,
      branchId: created.branchId,
      name: parsed.name,
      baseCurrency: parsed.baseCurrency,
      storeCode: created.storeCode,
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
    await recordAudit(tx, {
      ...audit,
      id: dependencies.newId(),
      userId: createdBy,
      action: "tenancy.tenant.created",
      entity: { type: "tenancy.tenant", id: created.tenantId },
      after: {
        name: tenant.name,
        baseCurrency: tenant.baseCurrency,
        storeCode: tenant.storeCode,
        defaultBranchId: tenant.defaultBranchId,
      },
    });
    await recordAudit(tx, {
      ...audit,
      id: dependencies.newId(),
      userId: createdBy,
      action: "access.user.created",
      entity: { type: "access.user", id: created.ownerId },
      after: { name: parsed.ownerName, login: parsed.ownerLogin, isOwner: true },
    });
  }
}
