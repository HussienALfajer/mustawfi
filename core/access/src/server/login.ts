import { recordAudit } from "@mustawfi/core-audit/server";
import { ProblemError } from "@mustawfi/core-config/server";
import type { PermissionCatalogue } from "@mustawfi/core-config/shared";
import { currentTenant, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import { eq } from "drizzle-orm";
import { accessProblemCodes, loginSchema } from "../shared/index.ts";
import type { AccessDependencies } from "./dependencies.ts";
import { verifyNothing, verifyPassword } from "./passwords.ts";
import { users } from "./schema.ts";
import { openSession, sessionUser, type SessionUser } from "./sessions.ts";
import { userAccess } from "./users.ts";

export interface LoginInput {
  readonly storeCode: string;
  readonly login: string;
  readonly password: string;
}

export interface LoggedIn {
  readonly tenantId: string;
  readonly user: SessionUser;
  /** The bearer token, handed to the client once; only its hash is stored. */
  readonly token: string;
  readonly expiresAt: Date;
}

function loginFailed(): ProblemError {
  return new ProblemError(accessProblemCodes.loginFailed, 401, {
    title: "The store code, login, or password is wrong",
  });
}

/**
 * Password sign-in (ADR-0022): the store code names the tenant (ADR-0029), the login the
 * user, and the password is checked against its Argon2id hash. Success opens a session; every
 * attempt within a known store is audited, success or not. Every failure is the same 401
 * `access.login.failed` and takes about as long, so a caller cannot tell an unknown store or
 * login from a wrong password.
 */
export async function logIn(
  tenants: TenantDatabase,
  input: LoginInput,
  dependencies: AccessDependencies & { readonly permissionCatalogue: PermissionCatalogue },
): Promise<LoggedIn> {
  const tenantId = await tenants.resolveStoreCode(input.storeCode);
  if (tenantId === undefined) {
    await verifyNothing(input.password);
    throw loginFailed();
  }

  const login = loginSchema.safeParse(input.login);
  const found = await tenants.withTenant({ tenantId }, async (tx) => {
    const tenant = await currentTenant(tx);
    if (tenant === undefined) throw new Error(`tenant ${tenantId} has a store code but no row`);
    const [user] = login.success
      ? await tx
          .select({
            id: users.id,
            branchId: users.branchId,
            name: users.name,
            login: users.login,
            passwordHash: users.passwordHash,
            status: users.status,
          })
          .from(users)
          .where(eq(users.login, login.data))
      : [];
    return { defaultBranchId: tenant.defaultBranchId, user };
  });

  const { user } = found;
  // A deactivated user, or one without a password (PIN only), fails like a wrong password.
  const passwordHash = user?.status === "active" ? user.passwordHash : null;
  const verified =
    passwordHash === null
      ? await verifyNothing(input.password).then(() => false)
      : await verifyPassword(passwordHash, input.password);

  const now = dependencies.clock.now();
  if (user === undefined || !verified) {
    await tenants.withTenant({ tenantId }, (tx) =>
      recordAudit(tx, {
        id: dependencies.newId(),
        tenantId,
        branchId: user?.branchId ?? found.defaultBranchId,
        occurredAt: now,
        userId: null,
        action: "access.login.failed",
        // The typed text is not kept: people type passwords into the login field by mistake.
        ...(user === undefined ? {} : { entity: { type: "access.user", id: user.id } }),
      }),
    );
    throw loginFailed();
  }

  const session = await tenants.withTenant({ tenantId, userId: user.id }, async (tx) => {
    const opened = await openSession(
      tx,
      { tenantId, branchId: user.branchId, userId: user.id },
      dependencies,
    );
    await recordAudit(tx, {
      id: dependencies.newId(),
      tenantId,
      branchId: user.branchId,
      occurredAt: now,
      userId: user.id,
      action: "access.login.succeeded",
      entity: { type: "access.session", id: opened.sessionId },
      after: { login: user.login },
    });
    const access = await userAccess(tx, user.id, dependencies.permissionCatalogue);
    if (access === undefined) throw new Error(`user ${user.id} vanished during sign-in`);
    return { ...opened, access };
  });

  return {
    tenantId,
    user: sessionUser(user, session.access, dependencies.permissionCatalogue).user,
    token: session.token,
    expiresAt: session.expiresAt,
  };
}
