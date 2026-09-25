import { loginSchema, passwordSchema, userNameSchema } from "@mustawfi/core-access/shared";
import { createOwner, hashPassword } from "@mustawfi/core-access/server";
import { recordAudit } from "@mustawfi/core-audit/server";
import { seedAccounts } from "@mustawfi/core-ledger/server";
import {
  currencyCodeSchema,
  STORE_CODE_LENGTH,
  tenantNameSchema,
  verifyLicense,
} from "@mustawfi/core-tenancy/shared";
import {
  createTenant,
  currentTenant,
  type TenantDatabase,
  type TenantTransaction,
} from "@mustawfi/core-tenancy/server";
import { randomCode, type RandomSource } from "@mustawfi/kernel";
import { z } from "zod";
import { installAuditedLicense, type LicenseDependencies } from "./install-license.ts";

export const createTenantInputSchema = z.object({
  name: tenantNameSchema,
  baseCurrency: currencyCodeSchema,
  ownerName: userNameSchema,
  ownerLogin: loginSchema,
  ownerPassword: passwordSchema,
  /** The license issued for the new tenant (ADR-0030); the tenant id is its claim. */
  license: z
    .string({ error: "a tenant needs a license" })
    .trim()
    .min(1, "a tenant needs a license"),
});

export type CreateTenantInput = z.input<typeof createTenantInputSchema>;

export interface CreatedTenant {
  readonly tenantId: string;
  readonly branchId: string;
  readonly ownerId: string;
  /** What the owner types to sign in (ADR-0029). */
  readonly storeCode: string;
}

export interface CreateTenantDependencies extends LicenseDependencies {
  readonly random: RandomSource;
}

/** The license names a tenant that already exists: a renewal goes through `license:install`. */
export class TenantExistsError extends Error {
  override name = "TenantExistsError";
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
 * Flow 1 of the walking skeleton, licensed (`core-foundation` rule 2): a tenant whose id is the
 * license's tenant claim, its installed license, its hidden default branch, its base currency,
 * its store code, its owner, and its seeded accounts, in one `withTenant` transaction for the
 * new tenant — all or nothing, and audited in the same transaction. Runs as `mustawfi_app`
 * under RLS like every other write. A store code another tenant already holds is drawn again.
 */
export async function createTenantWithOwner(
  tenants: TenantDatabase,
  input: CreateTenantInput,
  dependencies: CreateTenantDependencies,
): Promise<CreatedTenant> {
  const parsed = createTenantInputSchema.parse(input);
  // A bad license is refused before any work; `installLicense` checks it again in the transaction.
  const { claims } = await verifyLicense(parsed.license, dependencies.licenseKeys);
  const passwordHash = await hashPassword(parsed.ownerPassword);
  const ids = {
    tenantId: claims.tenant,
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
    if ((await currentTenant(tx)) !== undefined) {
      throw new TenantExistsError(`tenant ${created.tenantId} already exists`);
    }
    const tenant = await createTenant(tx, {
      tenantId: created.tenantId,
      branchId: created.branchId,
      name: parsed.name,
      baseCurrency: parsed.baseCurrency,
      storeCode: created.storeCode,
      createdAt,
      createdBy,
    });
    await installAuditedLicense(tx, parsed.license, dependencies);
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
    const accounts = await seedAccounts(
      tx,
      { tenantId: created.tenantId, branchId: created.branchId, createdAt, createdBy },
      dependencies.newId,
    );
    await recordAudit(tx, {
      ...audit,
      id: dependencies.newId(),
      userId: createdBy,
      action: "ledger.accounts.seeded",
      after: {
        accounts: accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, kind: a.kind })),
      },
    });
  }
}
