import { recordAudit } from "@mustawfi/core-audit/server";
import { ProblemError } from "@mustawfi/core-config/server";
import type { TenantDatabase, TenantTransaction } from "@mustawfi/core-tenancy/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { accessProblemCodes, loginSchema } from "../shared/index.ts";
import type { AccessDependencies } from "./dependencies.ts";
import {
  clearLoginFailures,
  countedByAddress,
  refuseThrottledAddress,
  type SignInDependencies,
  type SignInSource,
} from "./login.ts";
import { hashPassword, hashPin } from "./passwords.ts";
import { resetCodes, roles, users } from "./schema.ts";
import { issueOneTimeCode, oneTimeCodeHash } from "./secrets.ts";
import { revokeUserSessions } from "./users.ts";

/** A support reset code works for thirty minutes (`core-foundation` rule 27). */
export const RESET_CODE_LIFETIME_MS = 30 * 60 * 1000;

/** `access:reset-code` refused: the reason is for Vertex staff, printed by the CLI. */
export class ResetCodeRefused extends Error {
  override name = "ResetCodeRefused";
}

export interface ResetCodeRequest {
  readonly storeCode: string;
  /** The owner's login. */
  readonly login: string;
  /** The Vertex staff member issuing it, kept with the code and in the audit log. */
  readonly staff: string;
}

export interface IssuedResetCode {
  readonly id: string;
  /** Given to the owner once, as `ABCDE-FGHJK`; only its hash is stored. */
  readonly code: string;
  readonly expiresAt: Date;
  readonly userId: string;
}

/** The active or deactivated user with `login`, and whether their role is the owner role. */
async function userByLogin(tx: TenantTransaction, login: string) {
  const [user] = await tx
    .select({
      id: users.id,
      branchId: users.branchId,
      status: users.status,
      passwordHash: users.passwordHash,
      pinVerifier: users.pinVerifier,
      isOwner: roles.isOwner,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.login, login));
  return user;
}

/**
 * `access:reset-code` (rule 27, flow 3): Vertex support issues a one-time code with which an
 * owner who lost their password sets a new one. Only an active owner gets one — owners reset
 * other users themselves. Valid for thirty minutes, single use, stored as a hash; audited
 * `access.resetCode.issued` as done by support (no user of the tenant, `issuedBy: "support"`,
 * the staff member named).
 */
export async function issueResetCode(
  tenants: TenantDatabase,
  request: ResetCodeRequest,
  dependencies: AccessDependencies,
): Promise<IssuedResetCode> {
  const staff = request.staff.trim();
  if (staff === "" || staff.length > 100) {
    throw new ResetCodeRefused("name the staff member issuing the code (1–100 characters)");
  }
  const tenantId = await tenants.resolveStoreCode(request.storeCode);
  if (tenantId === undefined) throw new ResetCodeRefused(`no store has code ${request.storeCode}`);
  const login = loginSchema.safeParse(request.login);
  if (!login.success) throw new ResetCodeRefused(`${request.login} is not a login`);

  return tenants.withTenant({ tenantId }, async (tx) => {
    const user = await userByLogin(tx, login.data);
    if (user === undefined) throw new ResetCodeRefused(`the store has no user ${login.data}`);
    if (!user.isOwner) {
      throw new ResetCodeRefused(
        `${login.data} is not an owner: support resets owners; an owner resets other users`,
      );
    }
    if (user.status !== "active") throw new ResetCodeRefused(`${login.data} is deactivated`);

    const now = dependencies.clock.now();
    const expiresAt = new Date(now.getTime() + RESET_CODE_LIFETIME_MS);
    const { token: code, hash } = issueOneTimeCode(dependencies.random);
    const id = dependencies.newId();
    await tx.insert(resetCodes).values({
      id,
      tenantId,
      branchId: user.branchId,
      createdAt: now,
      createdBy: null,
      issuedBySupport: true,
      issuedBy: staff,
      userId: user.id,
      codeHash: hash,
      expiresAt,
    });
    await recordAudit(tx, {
      id: dependencies.newId(),
      tenantId,
      branchId: user.branchId,
      occurredAt: now,
      userId: null,
      action: "access.resetCode.issued",
      entity: { type: "access.user", id: user.id },
      after: {
        resetCodeId: id,
        expiresAt: expiresAt.toISOString(),
        issuedBy: "support",
        staff,
      },
    });
    return { id, code, expiresAt, userId: user.id };
  });
}

export interface PasswordReset {
  readonly storeCode: string;
  readonly login: string;
  readonly code: string;
  readonly password: string;
  /** A new PIN too, when support asked the owner to set one. */
  readonly pin?: string | undefined;
}

function resetCodeInvalid(): ProblemError {
  return new ProblemError(accessProblemCodes.resetCodeInvalid, 401, {
    title: "The store code, login, or reset code is wrong, used, or expired",
  });
}

/**
 * `POST /api/v1/access/password-reset` (rule 27): the owner named by the store code and login
 * sets a new password (and PIN) with a support reset code, which is used up. Their sessions
 * end, their failed sign-ins are cleared, and the change is audited
 * `access.user.passwordReset` as done with support's code. Every refusal is the same 401
 * `access.resetCode.invalid` and counts against the source address like a failed sign-in.
 */
export async function resetPasswordWithCode(
  tenants: TenantDatabase,
  reset: PasswordReset,
  source: SignInSource,
  dependencies: SignInDependencies,
): Promise<void> {
  const tenantId = await tenants.resolveStoreCode(reset.storeCode);
  await refuseThrottledAddress(tenants, source, tenantId, dependencies);
  await countedByAddress(source, dependencies, async () => {
    // Hashed before anything is looked up, so every refusal takes about as long.
    const passwordHash = await hashPassword(reset.password);
    const pinVerifier = reset.pin === undefined ? undefined : await hashPin(reset.pin);
    const codeHash = oneTimeCodeHash(reset.code);
    const login = loginSchema.safeParse(reset.login);
    if (tenantId === undefined || codeHash === undefined || !login.success) {
      throw resetCodeInvalid();
    }
    const now = dependencies.clock.now();
    await tenants.withTenant({ tenantId }, async (tx) => {
      const user = await userByLogin(tx, login.data);
      if (user === undefined || !user.isOwner || user.status !== "active") {
        throw resetCodeInvalid();
      }
      const [used] = await tx
        .update(resetCodes)
        .set({ usedAt: now })
        .where(
          and(
            eq(resetCodes.codeHash, codeHash),
            eq(resetCodes.userId, user.id),
            isNull(resetCodes.usedAt),
            gt(resetCodes.expiresAt, now),
          ),
        )
        .returning({ id: resetCodes.id });
      if (used === undefined) throw resetCodeInvalid();

      await tx
        .update(users)
        .set({
          passwordHash,
          ...(pinVerifier === undefined ? {} : { pinVerifier, pinChangedAt: now }),
        })
        .where(eq(users.id, user.id));
      const actor = { tenantId, branchId: user.branchId, userId: user.id, at: now };
      await recordAudit(tx, {
        id: dependencies.newId(),
        tenantId,
        branchId: user.branchId,
        occurredAt: now,
        userId: user.id,
        action: "access.user.passwordReset",
        entity: { type: "access.user", id: user.id },
        before: {
          hasPassword: user.passwordHash !== null,
          ...(pinVerifier === undefined ? {} : { hasPin: user.pinVerifier !== null }),
        },
        after: {
          hasPassword: true,
          ...(pinVerifier === undefined ? {} : { hasPin: true }),
          resetCodeId: used.id,
          issuedBy: "support",
        },
      });
      await revokeUserSessions(tx, actor, user.id, dependencies);
      await clearLoginFailures(tx, login.data);
    });
  });
}
