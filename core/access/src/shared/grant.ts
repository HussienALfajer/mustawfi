import type { PermissionCatalogue, RoleTemplate } from "@mustawfi/core-config/shared";

/** An editable role as stored: its own rows, and the template grants it has received. */
export interface StoredRole {
  /** The template it was seeded from; null for a copy. */
  readonly template: RoleTemplate | null;
  readonly permissions: readonly string[];
  readonly limits: Readonly<Record<string, string>>;
  /** The template grants recorded for it: received at seeding or at an edit, kept or removed. */
  readonly offered: {
    readonly permissions: readonly string[];
    readonly limits: readonly string[];
  };
}

/** What an editable role holds. */
export interface RoleHoldings {
  /** Sorted. */
  readonly permissions: readonly string[];
  /** By limit id, in id order. */
  readonly limits: Readonly<Record<string, string>>;
}

/**
 * What an editable role holds (`core-foundation` slice 6, user decision 2026-09-26): its own
 * permissions and limit values, plus every grant `catalogue`'s modules make to its template that
 * was never recorded for it — a permission or limit declared after the tenant was created. A
 * recorded grant the role no longer has was removed by an editor and stays removed. A copy
 * (no template) holds only its own rows. Grants of permissions and limits no module declares
 * any more are dropped.
 */
export function roleHoldings(catalogue: PermissionCatalogue, role: StoredRole): RoleHoldings {
  const permissions = new Set(role.permissions.filter((id) => catalogue.permissions.has(id)));
  const limits = new Map(Object.entries(role.limits).filter(([id]) => catalogue.limits.has(id)));
  const template = role.template;
  if (template !== null) {
    const offeredPermissions = new Set(role.offered.permissions);
    for (const permission of catalogue.permissions.values()) {
      if (permission.grants.includes(template) && !offeredPermissions.has(permission.id)) {
        permissions.add(permission.id);
      }
    }
    const offeredLimits = new Set(role.offered.limits);
    for (const limit of catalogue.limits.values()) {
      const value = limit.grants[template];
      if (value !== undefined && !offeredLimits.has(limit.id) && !limits.has(limit.id)) {
        limits.set(limit.id, value);
      }
    }
  }
  return {
    permissions: [...permissions].sort(),
    limits: Object.fromEntries([...limits].sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}

/** Every grant `catalogue`'s modules make to `template`: what an edit records as offered. */
export function templateGrants(
  catalogue: PermissionCatalogue,
  template: RoleTemplate,
): { readonly permissions: readonly string[]; readonly limits: readonly string[] } {
  return {
    permissions: [...catalogue.permissions.values()]
      .filter((permission) => permission.grants.includes(template))
      .map((permission) => permission.id)
      .sort(),
    limits: [...catalogue.limits.values()]
      .filter((limit) => limit.grants[template] !== undefined)
      .map((limit) => limit.id)
      .sort(),
  };
}

/** What a user holds through their role and scope, as stored. */
export interface RoleAccess {
  /** The owner role: every permission, no department restriction, no limit (rule 14). */
  readonly isOwner: boolean;
  /** The role's permissions; ignored for the owner. */
  readonly permissions: readonly string[];
  /** The role's limit values by limit id, decimal strings; ignored for the owner. */
  readonly limits: Readonly<Record<string, string>>;
  /** Every department, or only `departments`. */
  readonly departmentScope: "all" | "listed";
  /** The active departments of a `listed` scope. */
  readonly departments: readonly string[];
}

/** How far a limited action may go: without bound (the owner), or up to `value`. */
export type LimitValue =
  { readonly unlimited: true } | { readonly unlimited: false; readonly value: string };

/** A user's resolved access (`core-foundation` rules 14–16). */
export interface AccessGrant {
  /**
   * Whether the user holds `permission`, in `departmentId` when the permission is scoped.
   * Throws for a permission no module declares, and for a scoped one asked without a
   * department: both are programming errors.
   */
  can(permission: string, departmentId?: string): boolean;
  /** The user's value of `limit`; a role without one may not go beyond zero (rule 16). */
  limitFor(limit: string): LimitValue;
  /** Every declared permission the user holds somewhere, sorted. */
  readonly permissions: readonly string[];
}

/** Resolves `access` against the declarations in `catalogue`. */
export function accessGrant(catalogue: PermissionCatalogue, access: RoleAccess): AccessGrant {
  const held = new Set(access.permissions);
  const departments = new Set(access.departments);
  const permissions = [...catalogue.permissions.keys()]
    .filter((id) => access.isOwner || held.has(id))
    .sort();
  return {
    permissions,
    can(permission, departmentId) {
      const declared = catalogue.permissions.get(permission);
      if (declared === undefined) {
        throw new TypeError(`permission ${permission} is not declared by any module`);
      }
      if (declared.scoped && departmentId === undefined) {
        throw new TypeError(`permission ${permission} is scoped: check it in a department`);
      }
      if (access.isOwner) return true;
      if (!held.has(permission)) return false;
      if (!declared.scoped || access.departmentScope === "all") return true;
      return departmentId !== undefined && departments.has(departmentId);
    },
    limitFor(limit) {
      if (!catalogue.limits.has(limit)) {
        throw new TypeError(`limit ${limit} is not declared by any module`);
      }
      if (access.isOwner) return { unlimited: true };
      return { unlimited: false, value: access.limits[limit] ?? "0" };
    },
  };
}
