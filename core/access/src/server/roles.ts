import { recordAudit } from "@mustawfi/core-audit/server";
import { ProblemError } from "@mustawfi/core-config/server";
import {
  limitValueSchema,
  type PermissionCatalogue,
  ROLE_TEMPLATES,
  type RoleTemplate,
} from "@mustawfi/core-config/shared";
import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import { accessProblemCodes, roleNameSchema } from "../shared/index.ts";
import type { AccessDependencies } from "./dependencies.ts";
import { roleLimits, rolePermissions, roles } from "./schema.ts";

/** Who creates a role, and when. */
export interface RoleActor {
  readonly tenantId: string;
  readonly branchId: string;
  readonly userId: string;
  readonly at: Date;
}

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

/**
 * Creates an editable role in `tx`, a `withTenant` transaction, with its permissions and limit
 * values, audited `access.role.created`. Every permission and limit must be declared in
 * `catalogue` (rule 13); a malformed value or an unknown declaration is a 422
 * `access.role.invalid`. The owner role is not created here (`seedRoles`).
 */
export async function createRole(
  tx: TenantTransaction,
  actor: RoleActor,
  role: NewRole,
  catalogue: PermissionCatalogue,
  dependencies: AccessDependencies,
): Promise<void> {
  const name = roleNameSchema.parse(role.name);
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
  await insertRole(tx, actor, { id: role.id, name, template: role.template ?? null }, false);
  const standard = {
    tenantId: actor.tenantId,
    branchId: actor.branchId,
    createdAt: actor.at,
    createdBy: actor.userId,
    roleId: role.id,
  };
  if (permissions.length > 0) {
    await tx
      .insert(rolePermissions)
      .values(
        permissions.map((permission) => ({ ...standard, id: dependencies.newId(), permission })),
      );
  }
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
  await recordAudit(tx, {
    id: dependencies.newId(),
    tenantId: actor.tenantId,
    branchId: actor.branchId,
    occurredAt: actor.at,
    userId: actor.userId,
    action: "access.role.created",
    entity: { type: "access.role", id: role.id },
    after: {
      name,
      template: role.template ?? null,
      isOwner: false,
      permissions,
      limits: Object.fromEntries(limits),
    },
  });
}

async function insertRole(
  tx: TenantTransaction,
  actor: RoleActor,
  role: { readonly id: string; readonly name: string; readonly template: string | null },
  isOwner: boolean,
): Promise<void> {
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
  await recordAudit(tx, {
    id: dependencies.newId(),
    tenantId: actor.tenantId,
    branchId: actor.branchId,
    occurredAt: actor.at,
    userId: actor.userId,
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
        permissions: [...catalogue.permissions.values()]
          .filter((permission) => permission.grants.includes(template))
          .map((permission) => permission.id),
        limits,
      },
      catalogue,
      dependencies,
    );
  }
  return { ownerRoleId, templateRoleIds };
}
