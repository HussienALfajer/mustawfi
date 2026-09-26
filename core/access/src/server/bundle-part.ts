import type { BundlePart } from "@mustawfi/core-config/server";
import type { PermissionCatalogue } from "@mustawfi/core-config/shared";
import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import { asc, eq } from "drizzle-orm";
import { ACCESS_BUNDLE_PART, type AccessPart, catalogueView } from "../shared/index.ts";
import { listRoles } from "./roles.ts";
import { users } from "./schema.ts";
import { scopesOf } from "./users.ts";

/**
 * The bundle's `access` part (ADR-0030, `core-foundation` rules 14–20): the catalogue, every
 * active user of the tenant with role, scope, and PIN verifier, and the roles they hold. Ordered
 * by id throughout, so the same data gives the same text and the same bundle version.
 */
export function accessBundlePart(catalogue: PermissionCatalogue): BundlePart<TenantTransaction> {
  return {
    name: ACCESS_BUNDLE_PART,
    async build(tx): Promise<AccessPart> {
      const active = await tx
        .select({
          id: users.id,
          name: users.name,
          roleId: users.roleId,
          departmentScope: users.departmentScope,
          pinVerifier: users.pinVerifier,
          pinChangedAt: users.pinChangedAt,
        })
        .from(users)
        .where(eq(users.status, "active"))
        .orderBy(asc(users.id));
      const scopes = await scopesOf(
        tx,
        active.filter((user) => user.departmentScope === "listed").map((user) => user.id),
      );
      const held = new Set(active.map((user) => user.roleId));
      const roles = (await listRoles(tx, catalogue))
        .filter((role) => held.has(role.id))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((role) => ({
          id: role.id,
          name: role.name,
          isOwner: role.isOwner,
          permissions: [...role.permissions].sort(),
          limits: role.limits,
        }));
      return {
        catalogue: catalogueView(catalogue),
        roles,
        users: active.map((user) => ({
          id: user.id,
          name: user.name,
          roleId: user.roleId,
          departmentScope: user.departmentScope === "listed" ? "listed" : "all",
          departments:
            user.departmentScope === "listed" ? [...(scopes.get(user.id) ?? [])].sort() : [],
          pinVerifier: user.pinVerifier,
          pinChangedAt: user.pinChangedAt?.toISOString() ?? null,
        })),
      };
    },
  };
}
