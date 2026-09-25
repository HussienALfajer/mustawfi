import type { PermissionCatalogue } from "@mustawfi/core-config/shared";

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
