import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import type { IdGenerator } from "@mustawfi/kernel";
import { isNotNull } from "drizzle-orm";
import {
  systemAccountKeySchema,
  type AccountKind,
  type SystemAccountKey,
} from "../shared/index.ts";
import { accounts } from "./schema.ts";

export interface Account {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: AccountKind;
  readonly systemKey: SystemAccountKey | null;
}

/**
 * The accounts every tenant starts with: what the walking skeleton's cash sale posts to. The
 * sector templates of the chart of accounts replace this list in `core-foundation`. Names are
 * the tenant's data, in the tenant's language, and stay editable (ADR-0006).
 */
export const SEEDED_ACCOUNTS: readonly (Omit<Account, "id" | "systemKey"> & {
  readonly systemKey: SystemAccountKey;
})[] = [
  { code: "1100", name: "الصندوق", kind: "asset", systemKey: "cash" },
  { code: "4100", name: "إيرادات المبيعات", kind: "revenue", systemKey: "salesRevenue" },
  { code: "5900", name: "فروق التقريب", kind: "expense", systemKey: "roundingDifferences" },
];

export interface AccountSeed {
  /** Must be the tenant of the `withTenant` context `tx` runs in. */
  readonly tenantId: string;
  readonly branchId: string;
  readonly createdAt: Date;
  readonly createdBy: string;
}

/**
 * Writes the seeded accounts for a new tenant in `tx`, the transaction that creates the
 * tenant. Seeding twice fails on the per-tenant code (`23505`).
 */
export async function seedAccounts(
  tx: TenantTransaction,
  seed: AccountSeed,
  newId: IdGenerator,
): Promise<Account[]> {
  const rows = SEEDED_ACCOUNTS.map((account) => ({ id: newId(), ...account }));
  await tx.insert(accounts).values(
    rows.map((row) => ({
      ...row,
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      createdAt: seed.createdAt,
      createdBy: seed.createdBy,
    })),
  );
  return rows;
}

/**
 * The current tenant's system accounts by role. Throws when one is missing: every tenant is
 * seeded with all of them, so a gap is a defect, not a business case.
 */
export async function systemAccounts(
  tx: TenantTransaction,
): Promise<Record<SystemAccountKey, Account>> {
  const rows = await tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      kind: accounts.kind,
      systemKey: accounts.systemKey,
    })
    .from(accounts)
    .where(isNotNull(accounts.systemKey));
  const found = new Map(rows.map((row) => [row.systemKey, row]));
  const result: Partial<Record<SystemAccountKey, Account>> = {};
  for (const key of systemAccountKeySchema.options) {
    const row = found.get(key);
    if (row === undefined) throw new Error(`the tenant has no "${key}" account`);
    result[key] = { ...row, kind: row.kind as AccountKind, systemKey: key };
  }
  return result as Record<SystemAccountKey, Account>;
}
