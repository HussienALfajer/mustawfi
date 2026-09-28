import { lastChanges } from "@mustawfi/core-audit/server";
import type { LastChange } from "@mustawfi/core-audit/shared";
import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import { userNames } from "./names.ts";

/**
 * The last change of each of `ids` (records of `entityType`) among `actions`, with the name of
 * who made it, for the «last changed by … on …» line of details panels (`core-foundation`
 * slice 20). Records without such an entry are left out. Other modules' lists name their
 * changers through it, since the users are this module's.
 */
export async function namedLastChanges(
  tx: TenantTransaction,
  entityType: string,
  ids: readonly string[],
  actions: readonly string[],
): Promise<Map<string, LastChange>> {
  const found = await lastChanges(tx, entityType, ids, actions);
  const userIds = [...new Set([...found.values()].flatMap((change) => change.userId ?? []))];
  const names = await userNames(tx, userIds);
  const result = new Map<string, LastChange>();
  for (const [id, change] of found) {
    result.set(id, {
      entryId: change.entryId,
      at: change.at.toISOString(),
      by:
        change.userId === null || change.bySupport
          ? null
          : { id: change.userId, name: names.get(change.userId) ?? "" },
      bySupport: change.bySupport,
    });
  }
  return result;
}
