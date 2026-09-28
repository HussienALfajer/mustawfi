import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import { inArray } from "drizzle-orm";
import { devices, users } from "./schema.ts";

/**
 * The names of the current tenant's users among `ids`: other modules name who did something
 * through it, since the users are this module's. Unknown ids are left out.
 */
export async function userNames(
  tx: TenantTransaction,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** The names of the current tenant's devices among `ids`, revoked ones included. */
export async function deviceNames(
  tx: TenantTransaction,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: devices.id, name: devices.name })
    .from(devices)
    .where(inArray(devices.id, unique));
  return new Map(rows.map((row) => [row.id, row.name]));
}
