import { createRole, createUser, hashPassword } from "@mustawfi/core-access/server";
import type { PermissionCatalogue } from "@mustawfi/core-config/shared";
import type { TenantDatabase } from "@mustawfi/core-tenancy/server";
import type { Clock, IdGenerator, RandomSource } from "@mustawfi/kernel";
import type { FastifyInstance } from "fastify";
import { serverPermissions } from "./modules.ts";
import type { CreatedTenant } from "./tenants/create-tenant.ts";

export const STAFF_PASSWORD = "a staff member's long password";

let staffPasswordHash: Promise<string> | undefined;

export interface StaffUser {
  readonly userId: string;
  readonly roleId: string;
  readonly login: string;
}

export interface NewStaffUser {
  readonly login: string;
  /** The permissions of the user's own new role. */
  readonly permissions: readonly string[];
  /** A listed department scope; every department when omitted. */
  readonly departments?: readonly string[];
  /** The limit values of the user's role; none when omitted. */
  readonly limits?: Readonly<Record<string, string>>;
  /** What the permissions and limits are declared in; the server's modules when omitted. */
  readonly catalogue?: PermissionCatalogue;
}

/**
 * A user of `tenant` with a role of their own holding exactly `permissions` (`core-foundation`
 * slice 5), created through `core.access` as the owner would, with `STAFF_PASSWORD`.
 */
export async function createStaffUser(
  tenants: TenantDatabase,
  tenant: CreatedTenant,
  user: NewStaffUser,
  dependencies: {
    readonly clock: Clock;
    readonly newId: IdGenerator;
    readonly random: RandomSource;
  },
): Promise<StaffUser> {
  staffPasswordHash ??= hashPassword(STAFF_PASSWORD);
  const passwordHash = await staffPasswordHash;
  const roleId = dependencies.newId();
  const userId = dependencies.newId();
  const at = dependencies.clock.now();
  const actor = {
    tenantId: tenant.tenantId,
    branchId: tenant.branchId,
    userId: tenant.ownerId,
    at,
  };
  await tenants.withTenant({ tenantId: tenant.tenantId, userId: tenant.ownerId }, async (tx) => {
    await createRole(
      tx,
      actor,
      {
        id: roleId,
        name: `role of ${user.login}`,
        permissions: user.permissions,
        ...(user.limits === undefined ? {} : { limits: user.limits }),
      },
      user.catalogue ?? serverPermissions(),
      dependencies,
    );
    await createUser(
      tx,
      {
        id: userId,
        tenantId: tenant.tenantId,
        branchId: tenant.branchId,
        name: user.login,
        login: user.login,
        passwordHash,
        roleId,
        departmentScope: user.departments === undefined ? "all" : { listed: user.departments },
        createdAt: at,
        createdBy: tenant.ownerId,
      },
      dependencies,
    );
  });
  return { userId, roleId, login: user.login };
}

/** Signs `login` in to `tenant` with `password` and returns the bearer token. */
export async function signInAs(
  server: FastifyInstance,
  tenant: CreatedTenant,
  login: string,
  password = STAFF_PASSWORD,
): Promise<string> {
  const response = await server.inject({
    method: "POST",
    url: "/api/v1/access/login",
    payload: { storeCode: tenant.storeCode, login, password },
  });
  if (response.statusCode !== 200) {
    throw new Error(`sign-in of ${login} answered ${String(response.statusCode)}`);
  }
  return response.json<{ token: string }>().token;
}
