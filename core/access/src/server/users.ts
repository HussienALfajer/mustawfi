import { activeDepartments, type TenantTransaction } from "@mustawfi/core-tenancy/server";
import type { IdGenerator } from "@mustawfi/kernel";
import { and, eq, isNull } from "drizzle-orm";
import { newOwnerSchema, type NewOwnerInput, type RoleAccess } from "../shared/index.ts";
import { roleLimits, rolePermissions, roles, userDepartments, users } from "./schema.ts";

export interface NewUser extends NewOwnerInput {
  readonly id: string;
  readonly tenantId: string;
  readonly branchId: string;
  /** From `hashPassword`. */
  readonly passwordHash: string;
  /** An active role of the tenant. */
  readonly roleId: string;
  /** Every department, or the listed ones; an owner's is always `all`. */
  readonly departmentScope: "all" | { readonly listed: readonly string[] };
  readonly createdAt: Date;
  readonly createdBy: string;
}

/**
 * Creates a user in `tx`, a `withTenant` transaction for `tenantId`, with their role and
 * department scope. The caller audits it: the tenant's creation for its first owner, the user
 * routes later.
 */
export async function createUser(
  tx: TenantTransaction,
  user: NewUser,
  dependencies: { readonly newId: IdGenerator },
): Promise<void> {
  const { name, login } = newOwnerSchema.parse(user);
  if (!user.passwordHash.startsWith("$argon2id$")) {
    throw new TypeError("passwordHash must be an Argon2id hash from hashPassword");
  }
  const [role] = await tx
    .select({ isOwner: roles.isOwner })
    .from(roles)
    .where(and(eq(roles.id, user.roleId), isNull(roles.archivedAt)));
  if (role === undefined) throw new TypeError(`role ${user.roleId} is not an active role`);
  const listed = user.departmentScope === "all" ? [] : [...new Set(user.departmentScope.listed)];
  if (role.isOwner && user.departmentScope !== "all") {
    throw new TypeError("an owner's department scope is every department");
  }
  await tx.insert(users).values({
    id: user.id,
    tenantId: user.tenantId,
    branchId: user.branchId,
    createdAt: user.createdAt,
    createdBy: user.createdBy,
    name,
    login,
    passwordHash: user.passwordHash,
    roleId: user.roleId,
    departmentScope: user.departmentScope === "all" ? "all" : "listed",
  });
  if (listed.length > 0) {
    await tx.insert(userDepartments).values(
      listed.map((departmentId) => ({
        id: dependencies.newId(),
        tenantId: user.tenantId,
        branchId: user.branchId,
        createdAt: user.createdAt,
        createdBy: user.createdBy,
        userId: user.id,
        departmentId,
      })),
    );
  }
}

/** A user with their role, as sessions and sync ingest resolve them. */
export interface UserAccess {
  readonly role: { readonly id: string; readonly name: string; readonly isOwner: boolean };
  readonly access: RoleAccess;
}

/**
 * The role, permissions, limits, and scope of `userId` in the current `withTenant` context, or
 * `undefined` when the tenant has no such user. Sessions resolve their user with it, and sync
 * checks the user each operation names (ADR-0022). Archived departments leave a listed scope
 * (`core-foundation` rule 28).
 */
export async function userAccess(
  tx: TenantTransaction,
  userId: string,
): Promise<UserAccess | undefined> {
  const [row] = await tx
    .select({
      roleId: roles.id,
      roleName: roles.name,
      isOwner: roles.isOwner,
      departmentScope: users.departmentScope,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.id, userId));
  if (row === undefined) return undefined;
  const role = { id: row.roleId, name: row.roleName, isOwner: row.isOwner };
  const departmentScope = row.departmentScope === "listed" ? "listed" : "all";
  if (row.isOwner) {
    return {
      role,
      access: { isOwner: true, permissions: [], limits: {}, departmentScope, departments: [] },
    };
  }
  const permissions = await tx
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, row.roleId));
  const limits = await tx
    .select({ limitId: roleLimits.limitId, value: roleLimits.value })
    .from(roleLimits)
    .where(eq(roleLimits.roleId, row.roleId));
  let departments: string[] = [];
  if (departmentScope === "listed") {
    const listed = await tx
      .select({ departmentId: userDepartments.departmentId })
      .from(userDepartments)
      .where(eq(userDepartments.userId, userId));
    const ids = listed.map((l) => l.departmentId);
    const active = await activeDepartments(tx, ids);
    departments = ids.filter((id) => active.has(id));
  }
  return {
    role,
    access: {
      isOwner: false,
      permissions: permissions.map((p) => p.permission),
      limits: Object.fromEntries(limits.map((l) => [l.limitId, l.value])),
      departmentScope,
      departments,
    },
  };
}
