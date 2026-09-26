import { ProblemError } from "@mustawfi/core-config/server";
import { currentTenant, type TenantTransaction } from "@mustawfi/core-tenancy/server";
import { and, count, eq, isNull, lt, or } from "drizzle-orm";
import { Secret, TOTP } from "otpauth";
import {
  type AccountView,
  accessProblemCodes,
  RECOVERY_CODE_COUNT,
  totpCodeOf,
  type TwoFactorEnrolment,
} from "../shared/index.ts";
import { auditAs, type RoleActor } from "./actor.ts";
import type { AccessDependencies } from "./dependencies.ts";
import { verifyPassword } from "./passwords.ts";
import { recoveryCodes, users } from "./schema.ts";
import { openSecret, sealSecret, type TotpKeyRing } from "./sealed-secrets.ts";
import { issueOneTimeCode, oneTimeCodeHash } from "./secrets.ts";

/** What two-factor authentication needs besides time, ids, and randomness: the key ring. */
export type TwoFactorDependencies = AccessDependencies & { readonly totpKeys: TotpKeyRing };

/** RFC 6238 as every authenticator app reads it: SHA-1, six digits, thirty seconds. */
const TOTP_PERIOD_S = 30;
const TOTP_DIGITS = 6;
const TOTP_ALGORITHM = "SHA1";
/** One step either side, for a phone clock a little off. */
const TOTP_WINDOW = 1;
/** 160 bits (RFC 4226's recommendation). */
const TOTP_SECRET_BYTES = 20;
const ISSUER = "Mustawfi";

/** The associated data a user's sealed secret is bound to. */
function sealContext(tenantId: string, userId: string): string {
  return `core_access.users.totp_secret:${tenantId}:${userId}`;
}

/** The fields of a user row two-factor authentication reads. */
export interface TwoFactorUser {
  readonly id: string;
  readonly tenantId: string;
  readonly totpSecret: string | null;
  readonly totpEnabledAt: Date | null;
}

/**
 * The time step `code` belongs to when it is a valid TOTP code of `secret` at `now` (one step
 * either side), else `undefined`.
 */
function totpStep(secret: Uint8Array, code: string, now: Date): number | undefined {
  const delta = TOTP.validate({
    token: code,
    secret: new Secret({ buffer: secret.slice().buffer }),
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_S,
    timestamp: now.getTime(),
    window: TOTP_WINDOW,
  });
  if (delta === null) return undefined;
  return Math.floor(now.getTime() / 1000 / TOTP_PERIOD_S) + delta;
}

/**
 * Accepts `typed` as the second factor of `user`, whose two-factor authentication is on: a
 * TOTP code of a time step later than the last one accepted (a code is never accepted twice),
 * or one of their unused recovery codes, which is used up. Returns which it was, or
 * `undefined` when it is neither. Both checks are single conditional updates, so two requests
 * racing with one code cannot both pass.
 */
export async function useSecondFactor(
  tx: TenantTransaction,
  user: TwoFactorUser,
  typed: string,
  now: Date,
  dependencies: { readonly totpKeys: TotpKeyRing },
): Promise<
  | { readonly kind: "totp" }
  | { readonly kind: "recoveryCode"; readonly id: string; readonly remaining: number }
  | undefined
> {
  if (user.totpSecret === null || user.totpEnabledAt === null) {
    throw new Error("a second factor checked for a user without two-factor authentication");
  }
  const code = totpCodeOf(typed);
  if (code !== undefined) {
    const secret = openSecret(
      dependencies.totpKeys,
      user.totpSecret,
      sealContext(user.tenantId, user.id),
    );
    const step = totpStep(secret, code, now);
    if (step === undefined) return undefined;
    const [accepted] = await tx
      .update(users)
      .set({ totpLastStep: step })
      .where(
        and(eq(users.id, user.id), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))),
      )
      .returning({ id: users.id });
    return accepted === undefined ? undefined : { kind: "totp" };
  }
  const hash = oneTimeCodeHash(typed);
  if (hash === undefined) return undefined;
  const [used] = await tx
    .update(recoveryCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(recoveryCodes.userId, user.id),
        eq(recoveryCodes.codeHash, hash),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .returning({ id: recoveryCodes.id });
  if (used === undefined) return undefined;
  return { kind: "recoveryCode", id: used.id, remaining: await recoveryCodesLeft(tx, user.id) };
}

async function recoveryCodesLeft(tx: TenantTransaction, userId: string): Promise<number> {
  const [row] = await tx
    .select({ left: count() })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
  return row?.left ?? 0;
}

/**
 * Turns off `userId`'s two-factor authentication, finished or only started, and deletes their
 * recovery codes. Returns whether it was on. The caller audits.
 */
export async function removeTwoFactor(tx: TenantTransaction, userId: string): Promise<boolean> {
  const [before] = await tx
    .select({ enabledAt: users.totpEnabledAt })
    .from(users)
    .where(eq(users.id, userId));
  await tx
    .update(users)
    .set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null })
    .where(eq(users.id, userId));
  await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  return before?.enabledAt !== null && before?.enabledAt !== undefined;
}

function problem(code: string, status: number, title: string): ProblemError {
  return new ProblemError(code, status, { title });
}

const codeInvalid = () =>
  problem(
    accessProblemCodes.twoFactorCodeInvalid,
    422,
    "The code is wrong or was already used: use the code the app shows now",
  );

const notEnabled = () =>
  problem(accessProblemCodes.twoFactorNotEnabled, 409, "Two-factor authentication is off");

const passwordWrong = () =>
  problem(accessProblemCodes.currentSecretWrong, 403, "The current password is wrong");

/** The signed-in user's row, locked for the change. */
async function lockedSelf(tx: TenantTransaction, actor: RoleActor) {
  const [user] = await tx.select().from(users).where(eq(users.id, actor.userId)).for("update");
  if (user === undefined) throw new Error(`the signed-in user ${actor.userId} has no row`);
  return user;
}

/** `GET /api/v1/access/me`: the signed-in user's own account (flow 11). */
export async function accountOf(tx: TenantTransaction, userId: string): Promise<AccountView> {
  const [user] = await tx.select().from(users).where(eq(users.id, userId));
  if (user === undefined) throw new Error(`the signed-in user ${userId} has no row`);
  const enabled = user.totpEnabledAt !== null;
  return {
    id: user.id,
    name: user.name,
    login: user.login,
    hasPassword: user.passwordHash !== null,
    hasPin: user.pinVerifier !== null,
    twoFactor: {
      enabled,
      enabledAt: user.totpEnabledAt?.toISOString() ?? null,
      recoveryCodesLeft: enabled ? await recoveryCodesLeft(tx, user.id) : 0,
    },
  };
}

/**
 * Starts setting up two-factor authentication for the signed-in user (flow 11), proved with
 * their password: a new secret, sealed with the server key and not in force until confirmed.
 * Starting again replaces an unconfirmed secret. Refused without a password (409
 * `access.twoFactor.passwordRequired`) and while it is on (409 `access.twoFactor.alreadyEnabled`).
 * Not audited: nothing changes for sign-in until the confirmation, which is.
 */
export async function startTwoFactor(
  tx: TenantTransaction,
  actor: RoleActor,
  currentPassword: string,
  dependencies: TwoFactorDependencies,
): Promise<TwoFactorEnrolment> {
  const user = await lockedSelf(tx, actor);
  if (user.passwordHash === null || user.login === null) {
    throw problem(
      accessProblemCodes.twoFactorPasswordRequired,
      409,
      "Two-factor authentication protects a password: set one first",
    );
  }
  if (user.totpEnabledAt !== null) {
    throw problem(
      accessProblemCodes.twoFactorAlreadyEnabled,
      409,
      "Two-factor authentication is already on",
    );
  }
  if (!(await verifyPassword(user.passwordHash, currentPassword))) throw passwordWrong();
  const tenant = await currentTenant(tx);
  if (tenant === undefined) throw new Error("a signed-in user of a missing tenant");

  const bytes = dependencies.random.bytes(TOTP_SECRET_BYTES);
  const totpSecret = sealSecret(
    dependencies.totpKeys,
    bytes,
    sealContext(actor.tenantId, user.id),
    dependencies.random,
  );
  await tx.update(users).set({ totpSecret, totpLastStep: null }).where(eq(users.id, user.id));
  const totp = new TOTP({
    issuer: ISSUER,
    label: `${user.login}@${tenant.storeCode}`,
    secret: new Secret({ buffer: bytes.slice().buffer }),
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_S,
  });
  return { secret: totp.secret.base32, uri: totp.toString() };
}

/**
 * Turns two-factor authentication on with the first code the app shows (flow 11), audited
 * `access.twoFactor.enabled`, and returns ten new recovery codes, shown once and stored as
 * hashes. The code's time step counts as used. 409 `access.twoFactor.notStarted` without a
 * started enrolment, 422 `access.twoFactor.codeInvalid` for a wrong code.
 */
export async function confirmTwoFactor(
  tx: TenantTransaction,
  actor: RoleActor,
  typed: string,
  dependencies: TwoFactorDependencies,
): Promise<{ readonly recoveryCodes: string[] }> {
  const user = await lockedSelf(tx, actor);
  if (user.totpEnabledAt !== null) {
    throw problem(
      accessProblemCodes.twoFactorAlreadyEnabled,
      409,
      "Two-factor authentication is already on",
    );
  }
  if (user.totpSecret === null) {
    throw problem(
      accessProblemCodes.twoFactorNotStarted,
      409,
      "Start setting up two-factor authentication first",
    );
  }
  const code = totpCodeOf(typed);
  const secret = openSecret(
    dependencies.totpKeys,
    user.totpSecret,
    sealContext(actor.tenantId, user.id),
  );
  const step = code === undefined ? undefined : totpStep(secret, code, actor.at);
  if (step === undefined) throw codeInvalid();

  await tx
    .update(users)
    .set({ totpEnabledAt: actor.at, totpLastStep: step })
    .where(eq(users.id, user.id));
  await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
  const issued = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    issueOneTimeCode(dependencies.random),
  );
  await tx.insert(recoveryCodes).values(
    issued.map(({ hash }) => ({
      id: dependencies.newId(),
      tenantId: actor.tenantId,
      branchId: actor.branchId,
      createdAt: actor.at,
      createdBy: actor.userId,
      userId: user.id,
      codeHash: hash,
    })),
  );
  await auditAs(tx, actor, dependencies, {
    action: "access.twoFactor.enabled",
    entity: { type: "access.user", id: user.id },
    before: { twoFactor: false },
    after: { twoFactor: true, recoveryCodes: RECOVERY_CODE_COUNT },
  });
  return { recoveryCodes: issued.map(({ token }) => token) };
}

/**
 * Turns off the signed-in user's two-factor authentication (flow 11), proved with their
 * password and a code from the app or a recovery code; their recovery codes are deleted.
 * Audited `access.twoFactor.disabled`. 403 `access.user.currentSecretWrong` for a wrong
 * password, 422 `access.twoFactor.codeInvalid` for a wrong code.
 */
export async function disableTwoFactor(
  tx: TenantTransaction,
  actor: RoleActor,
  proof: { readonly currentPassword: string; readonly code: string },
  dependencies: TwoFactorDependencies,
): Promise<void> {
  const user = await lockedSelf(tx, actor);
  if (user.totpEnabledAt === null || user.passwordHash === null) throw notEnabled();
  if (!(await verifyPassword(user.passwordHash, proof.currentPassword))) throw passwordWrong();
  const factor = await useSecondFactor(tx, user, proof.code, actor.at, dependencies);
  if (factor === undefined) throw codeInvalid();
  await removeTwoFactor(tx, user.id);
  await auditAs(tx, actor, dependencies, {
    action: "access.twoFactor.disabled",
    entity: { type: "access.user", id: user.id },
    before: { twoFactor: true },
    after: { twoFactor: false, proof: factor.kind },
  });
}

/**
 * An owner clears another user's two-factor authentication (rule 26), when that user lost
 * their phone and their recovery codes; audited `access.twoFactor.cleared` with the reason. The caller checks
 * that the actor is an owner and not the user. 409 `access.twoFactor.notEnabled` when it is
 * off.
 */
export async function clearTwoFactor(
  tx: TenantTransaction,
  actor: RoleActor,
  userId: string,
  reason: string,
  dependencies: AccessDependencies,
): Promise<void> {
  if (!(await removeTwoFactor(tx, userId))) throw notEnabled();
  await auditAs(tx, actor, dependencies, {
    action: "access.twoFactor.cleared",
    entity: { type: "access.user", id: userId },
    before: { twoFactor: true },
    after: { twoFactor: false, clearedBy: "owner" },
    reason,
  });
}
