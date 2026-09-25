import { ProblemError } from "@mustawfi/core-config/server";
import {
  limitValueSchema,
  type PermissionCatalogue,
  ROLE_TEMPLATES,
  type RoleTemplate,
} from "@mustawfi/core-config/shared";
import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import {
  accessProblemCodes,
  type RoleHoldings,
  roleHoldings,
  roleNameSchema,
  type RoleView,
  type StoredRole,
  templateGrants,
} from "../shared/index.ts";
import { auditAs, type RoleActor, violates } from "./actor.ts";
import type { AccessDependencies } from "./dependencies.ts";
import { roleLimits, rolePermissions, roles, roleTemplateGrants, users } from "./schema.ts";

export type { RoleActor } from "./actor.ts";

/** The names the seeded roles start with; tenants rename them as they like. */
export const SEEDED_ROLE_NAMES: Readonly<Record<"owner" | RoleTemplate, string>> = {
  owner: "المالك",
  accountant: "المحاسب",
  sectionCashier: "كاشير القسم",
  repairTechnician: "فني الصيانة",
  topUpOperator: "موظف تعبئة الرصيد",
};

export interface NewRole {
  readonly id: string;
  readonly name: string;
  /** The template a seeded role comes from; absent for a copy. */
  readonly template?: RoleTemplate;
  readonly permissions: readonly string[];
  /** Limit values by limit id, decimal strings. */
  readonly limits?: Readonly<Record<string, string>>;
}

function unknownDeclaration(kind: "permission" | "limit", id: string): ProblemError {
  return new ProblemError(accessProblemCodes.roleInvalid, 422, {
    title: "The role names a permission or limit that does not exist",
    detail: `unknown ${kind} ${id}`,
  });
}

function roleNotFound(): ProblemError {
  return new ProblemError(accessProblemCodes.roleNotFound, 404, { title: "No such role" });
}

function roleArchived(): ProblemError {
  return new ProblemError(accessProblemCodes.roleArchived, 409, { title: "The role is archived" });
}

function nameTaken(error: unknown): unknown {
  if (!violates(error, "roles_active_name_per_tenant")) return error;
  return new ProblemError(accessProblemCodes.roleNameTaken, 409, {
    title: "Another active role has this name",
    cause: error,
  });
}

/**
 * A role's permissions and limit values, sorted and checked against `catalogue` (rule 13): an
 * unknown declaration or a malformed value is a 422 `access.role.invalid`.
 */
function checkedHoldings(
  role: {
    readonly permissions: readonly string[];
    readonly limits?: Readonly<Record<string, string>>;
  },
  catalogue: PermissionCatalogue,
): RoleHoldings {
  const permissions = [...new Set(role.permissions)].sort();
  for (const permission of permissions) {
    if (!catalogue.permissions.has(permission)) throw unknownDeclaration("permission", permission);
  }
  const limits = Object.entries(role.limits ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [limit, value] of limits) {
    if (!catalogue.limits.has(limit)) throw unknownDeclaration("limit", limit);
    if (!limitValueSchema.safeParse(value).success) {
      throw new ProblemError(accessProblemCodes.roleInvalid, 422, {
        title: "A limit value is not a non-negative decimal",
        detail: `${limit} = ${value}`,
      });
    }
  }
  return {
    permissions,
    limits: Object.fromEntries(limits.map(([limit, value]) => [limit, canonicalValue(value)])),
  };
}

/** Writes `holdings` as `roleId`'s rows, which must have none. */
async function insertHoldings(
  tx: TenantTransaction,
  actor: RoleActor,
  roleId: string,
  holdings: RoleHoldings,
  dependencies: AccessDependencies,
): Promise<void> {
  const standard = {
    tenantId: actor.tenantId,
    branchId: actor.branchId,
    createdAt: actor.at,
    createdBy: actor.userId,
    roleId,
  };
  if (holdings.permissions.length > 0) {
    await tx.insert(rolePermissions).values(
      holdings.permissions.map((permission) => ({
        ...standard,
        id: dependencies.newId(),
        permission,
      })),
    );
  }
  const limits = Object.entries(holdings.limits);
  if (limits.length > 0) {
    await tx.insert(roleLimits).values(
      limits.map(([limitId, value]) => ({
        ...standard,
        id: dependencies.newId(),
        limitId,
        value,
      })),
    );
  }
}

/**
 * Records every grant `catalogue` makes to `template` as offered to `roleId`: from now on, a
 * grant the role does not hold was removed on purpose and stays removed.
 */
async function recordTemplateGrants(
  tx: TenantTransaction,
  actor: RoleActor,
  roleId: string,
  template: RoleTemplate,
  catalogue: PermissionCatalogue,
  dependencies: AccessDependencies,
): Promise<void> {
  const grants = templateGrants(catalogue, template);
  const rows = [
    ...grants.permissions.map((grantId) => ({ kind: "permission", grantId })),
    ...grants.limits.map((grantId) => ({ kind: "limit", grantId })),
  ];
  if (rows.length === 0) return;
  await tx
    .insert(roleTemplateGrants)
    .values(
      rows.map((row) => ({
        ...row,
        id: dependencies.newId(),
        tenantId: actor.tenantId,
        branchId: actor.branchId,
        createdAt: actor.at,
        createdBy: actor.userId,
        roleId,
      })),
    )
    .onConflictDoNothing();
}

/**
 * Creates an editable role in `tx`, a `withTenant` transaction, with its permissions and limit
 * values, audited `access.role.created`. Every permission and limit must be declared in
 * `catalogue` (rule 13); a malformed value or an unknown declaration is a 422
 * `access.role.invalid`, a name another active role has a 409 `access.role.nameTaken`. A role
 * seeded from a template records the template's grants as offered. The owner role is not
 * created here (`seedRoles`).
 */
export async function createRole(
  tx: TenantTransaction,
  actor: RoleActor,
  role: NewRole,
  catalogue: PermissionCatalogue,
  dependencies: AccessDependencies,
): Promise<void> {
  const name = roleNameSchema.parse(role.name);
  const holdings = checkedHoldings(role, catalogue);
  await insertRole(tx, actor, { id: role.id, name, template: role.template ?? null }, false);
  await insertHoldings(tx, actor, role.id, holdings, dependencies);
  if (role.template !== undefined) {
    await recordTemplateGrants(tx, actor, role.id, role.template, catalogue, dependencies);
  }
  await auditAs(tx, actor, dependencies, {
    action: "access.role.created",
    entity: { type: "access.role", id: role.id },
    after: { name, template: role.template ?? null, isOwner: false, ...holdings },
  });
}

async function insertRole(
  tx: TenantTransaction,
  actor: RoleActor,
  role: { readonly id: string; readonly name: string; readonly template: string | null },
  isOwner: boolean,
): Promise<void> {
  try {
    await tx.insert(roles).values({
      id: role.id,
      tenantId: actor.tenantId,
      branchId: actor.branchId,
      createdAt: actor.at,
      createdBy: actor.userId,
      name: role.name,
      template: role.template,
      isOwner,
    });
  } catch (error) {
    throw nameTaken(error);
  }
}

/** The roles seeded with a tenant. */
export interface SeededRoles {
  readonly ownerRoleId: string;
  readonly templateRoleIds: Readonly<Record<RoleTemplate, string>>;
}

/**
 * Seeds a new tenant's roles in `tx` (`core-foundation` slice 5): the fixed owner role and one
 * editable role per template, holding the permissions and limit values the modules grant that
 * template in `catalogue`. Each is audited `access.role.created`.
 */
export async function seedRoles(
  tx: TenantTransaction,
  actor: RoleActor,
  catalogue: PermissionCatalogue,
  dependencies: AccessDependencies,
): Promise<SeededRoles> {
  const ownerRoleId = dependencies.newId();
  const ownerName = SEEDED_ROLE_NAMES.owner;
  await insertRole(tx, actor, { id: ownerRoleId, name: ownerName, template: "owner" }, true);
  await auditAs(tx, actor, dependencies, {
    action: "access.role.created",
    entity: { type: "access.role", id: ownerRoleId },
    after: { name: ownerName, template: "owner", isOwner: true },
  });

  const templateRoleIds = {} as Record<RoleTemplate, string>;
  for (const template of ROLE_TEMPLATES) {
    const id = dependencies.newId();
    templateRoleIds[template] = id;
    const limits: Record<string, string> = {};
    for (const limit of catalogue.limits.values()) {
      const value = limit.grants[template];
      if (value !== undefined) limits[limit.id] = value;
    }
    await createRole(
      tx,
      actor,
      {
        id,
        name: SEEDED_ROLE_NAMES[template],
        template,
        permissions: templateGrants(catalogue, template).permissions,
        limits,
      },
      catalogue,
      dependencies,
    );
  }
  return { ownerRoleId, templateRoleIds };
}

type RoleRow = typeof roles.$inferSelect;

/** The stored rows of `roleIds`: permissions, limits, and recorded template grants. */
async function storedRoles(
  tx: TenantTransaction,
  rows: readonly RoleRow[],
): Promise<Map<string, StoredRole>> {
  const ids = rows.map((row) => row.id);
  const result = new Map<string, StoredRole>();
  if (ids.length === 0) return result;
  const permissions = await tx
    .select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, ids));
  const limits = await tx
    .select({ roleId: roleLimits.roleId, limitId: roleLimits.limitId, value: roleLimits.value })
    .from(roleLimits)
    .where(inArray(roleLimits.roleId, ids));
  const offered = await tx
    .select({
      roleId: roleTemplateGrants.roleId,
      kind: roleTemplateGrants.kind,
      grantId: roleTemplateGrants.grantId,
    })
    .from(roleTemplateGrants)
    .where(inArray(roleTemplateGrants.roleId, ids));
  for (const row of rows) {
    const template = ROLE_TEMPLATES.find((t) => t === row.template) ?? null;
    result.set(row.id, {
      template,
      permissions: permissions.filter((p) => p.roleId === row.id).map((p) => p.permission),
      limits: Object.fromEntries(
        limits.filter((l) => l.roleId === row.id).map((l) => [l.limitId, canonicalValue(l.value)]),
      ),
      offered: {
        permissions: offered
          .filter((o) => o.roleId === row.id && o.kind === "permission")
          .map((o) => o.grantId),
        limits: offered
          .filter((o) => o.roleId === row.id && o.kind === "limit")
          .map((o) => o.grantId),
      },
    });
  }
  return result;
}

/**
 * A limit value in one spelling: `numeric(20,4)` reads back as `5.0000` and people type
 * `05` or `5.50`; all are `5` or `5.5` here, so equal values compare equal.
 */
function canonicalValue(value: string): string {
  const [whole = "", fraction = ""] = value.split(".");
  const digits = whole.replace(/^0+(?=\d)/, "");
  const decimals = fraction.replace(/0+$/, "");
  return decimals === "" ? digits : `${digits}.${decimals}`;
}

/**
 * What role `roleId` holds under `catalogue` (`roleHoldings`), or everything for the owner
 * role. Sessions and sync ingest resolve a user's access through it.
 */
export async function holdingsOf(
  tx: TenantTransaction,
  role: RoleRow,
  catalogue: PermissionCatalogue,
): Promise<RoleHoldings> {
  if (role.isOwner) return { permissions: [...catalogue.permissions.keys()].sort(), limits: {} };
  const stored = (await storedRoles(tx, [role])).get(role.id);
  if (stored === undefined) throw new Error(`role ${role.id} has no stored rows`);
  return roleHoldings(catalogue, stored);
}

function toView(row: RoleRow, holdings: RoleHoldings, activeUsers: number): RoleView {
  const template =
    row.template === "owner" ? "owner" : (ROLE_TEMPLATES.find((t) => t === row.template) ?? null);
  return {
    id: row.id,
    name: row.name,
    template,
    isOwner: row.isOwner,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    permissions: [...holdings.permissions],
    limits: { ...holdings.limits },
    activeUsers,
  };
}

async function activeUsersOf(tx: TenantTransaction, roleIds: readonly string[]) {
  if (roleIds.length === 0) return new Map<string, number>();
  const rows = await tx
    .select({ roleId: users.roleId, active: count() })
    .from(users)
    .where(and(inArray(users.roleId, [...roleIds]), eq(users.status, "active")))
    .groupBy(users.roleId);
  return new Map(rows.map((row) => [row.roleId, row.active]));
}

/** The tenant's roles, archived ones included: the owner role first, then by creation. */
export async function listRoles(
  tx: TenantTransaction,
  catalogue: PermissionCatalogue,
): Promise<RoleView[]> {
  const rows = await tx.select().from(roles).orderBy(asc(roles.createdAt), asc(roles.id));
  const stored = await storedRoles(
    tx,
    rows.filter((row) => !row.isOwner),
  );
  const active = await activeUsersOf(
    tx,
    rows.map((row) => row.id),
  );
  const everything = { permissions: [...catalogue.permissions.keys()].sort(), limits: {} };
  return rows
    .map((row) => {
      const role = stored.get(row.id);
      const holdings =
        row.isOwner || role === undefined ? everything : roleHoldings(catalogue, role);
      return toView(row, holdings, active.get(row.id) ?? 0);
    })
    .sort((a, b) => (a.isOwner === b.isOwner ? 0 : a.isOwner ? -1 : 1));
}

/** Role `id`, locked for the change, if it is editable: not the owner role, not archived. */
async function editableRole(tx: TenantTransaction, id: string): Promise<RoleRow> {
  const [row] = await tx.select().from(roles).where(eq(roles.id, id)).for("update");
  if (row === undefined) throw roleNotFound();
  if (row.isOwner) {
    throw new ProblemError(accessProblemCodes.ownerRoleFixed, 409, {
      title: "The owner role holds everything and cannot be changed",
    });
  }
  if (row.archivedAt !== null) throw roleArchived();
  return row;
}

/** A role's name and holdings, as its audit entries record them. */
const auditedRole = (name: string, holdings: RoleHoldings) => ({
  name,
  permissions: [...holdings.permissions],
  limits: { ...holdings.limits },
});

/**
 * Creates a copy (flow 7): a role without a template, holding what the editor chose — usually
 * what the role it was copied from holds. Audited `access.role.created`.
 */
export async function copyRole(
  tx: TenantTransaction,
  actor: RoleActor,
  role: Omit<NewRole, "id" | "template">,
  catalogue: PermissionCatalogue,
  dependencies: AccessDependencies,
): Promise<RoleView> {
  const id = dependencies.newId();
  await createRole(tx, actor, { ...role, id }, catalogue, dependencies);
  const [row] = await tx.select().from(roles).where(eq(roles.id, id));
  if (row === undefined) throw new Error("the new role vanished");
  return toView(row, await holdingsOf(tx, row, catalogue), 0);
}

/**
 * Replaces an editable role's name, permissions, and limit values (flow 7), audited
 * `access.role.changed` with both sides when something changed. A role seeded from a template
 * records every current template grant as offered, so a permission the editor removed is not
 * brought back by its template. Refused for the owner role (409 `access.role.ownerFixed`) and
 * an archived role (409 `access.role.archived`).
 */
export async function editRole(
  tx: TenantTransaction,
  actor: RoleActor,
  change: Omit<NewRole, "template">,
  catalogue: PermissionCatalogue,
  dependencies: AccessDependencies,
): Promise<RoleView> {
  const name = roleNameSchema.parse(change.name);
  const holdings = checkedHoldings(change, catalogue);
  const row = await editableRole(tx, change.id);
  const before = await holdingsOf(tx, row, catalogue);
  await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, row.id));
  await tx.delete(roleLimits).where(eq(roleLimits.roleId, row.id));
  await insertHoldings(tx, actor, row.id, holdings, dependencies);
  const template = ROLE_TEMPLATES.find((t) => t === row.template);
  if (template !== undefined) {
    await recordTemplateGrants(tx, actor, row.id, template, catalogue, dependencies);
  }
  let updated = row;
  if (name !== row.name) {
    try {
      const [renamed] = await tx
        .update(roles)
        .set({ name })
        .where(eq(roles.id, row.id))
        .returning();
      if (renamed === undefined) throw new Error("the role update returned no row");
      updated = renamed;
    } catch (error) {
      throw nameTaken(error);
    }
  }
  const beforeAudit = auditedRole(row.name, before);
  const afterAudit = auditedRole(name, holdings);
  if (JSON.stringify(beforeAudit) !== JSON.stringify(afterAudit)) {
    await auditAs(tx, actor, dependencies, {
      action: "access.role.changed",
      entity: { type: "access.role", id: row.id },
      before: beforeAudit,
      after: afterAudit,
    });
  }
  const active = await activeUsersOf(tx, [row.id]);
  return toView(updated, holdings, active.get(row.id) ?? 0);
}

/**
 * Archives an editable role (flow 7), audited `access.role.archived`. Refused while an active
 * user holds it (409 `access.role.inUse`); deactivated users keep it and need another role
 * before they are reactivated.
 */
export async function archiveRole(
  tx: TenantTransaction,
  actor: RoleActor,
  id: string,
  catalogue: PermissionCatalogue,
  dependencies: AccessDependencies,
): Promise<RoleView> {
  const row = await editableRole(tx, id);
  // Users take the role under the tenant lock; a user given this role concurrently commits
  // first or sees it archived (`activeRole` reads it `for share`).
  const active = (await activeUsersOf(tx, [row.id])).get(row.id) ?? 0;
  if (active > 0) {
    throw new ProblemError(accessProblemCodes.roleInUse, 409, {
      title: "Active users hold this role",
      detail: `${String(active)} active users hold it`,
    });
  }
  const [archived] = await tx
    .update(roles)
    .set({ archivedAt: actor.at, archivedBy: actor.userId })
    .where(and(eq(roles.id, row.id), isNull(roles.archivedAt)))
    .returning();
  if (archived === undefined) throw new Error("the role update returned no row");
  await auditAs(tx, actor, dependencies, {
    action: "access.role.archived",
    entity: { type: "access.role", id: row.id },
    before: { archivedAt: null },
    after: { archivedAt: actor.at.toISOString() },
  });
  return toView(archived, await holdingsOf(tx, archived, catalogue), 0);
}

/**
 * Role `id` if it is active, read `for share` so it cannot be archived until the transaction
 * that gives it to a user ends: 404 `access.role.notFound` or 409 `access.role.archived`.
 */
export async function activeRole(tx: TenantTransaction, id: string): Promise<RoleRow> {
  const [row] = await tx.select().from(roles).where(eq(roles.id, id)).for("share");
  if (row === undefined) throw roleNotFound();
  if (row.archivedAt !== null) throw roleArchived();
  return row;
}
