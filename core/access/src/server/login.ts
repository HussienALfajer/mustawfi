import { recordAudit } from "@mustawfi/core-audit/server";
import { ProblemError } from "@mustawfi/core-config/server";
import type { PermissionCatalogue } from "@mustawfi/core-config/shared";
import {
  currentLicenseStatus,
  currentTenant,
  licenseSuspended,
  type TenantDatabase,
  type TenantTransaction,
} from "@mustawfi/core-tenancy/server";
import {
  type LicenseStanding,
  licenseStanding,
  storeCodeSchema,
} from "@mustawfi/core-tenancy/shared";
import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import { accessProblemCodes, loginSchema } from "../shared/index.ts";
import type { AccessDependencies } from "./dependencies.ts";
import { authenticateDevice, type Device, deviceRequired, deviceRevoked } from "./devices.ts";
import { verifyNothing, verifyPassword } from "./passwords.ts";
import { loginAttempts, users } from "./schema.ts";
import { sha256Hex } from "./secrets.ts";
import { openSession, sessionUser, type SessionUser } from "./sessions.ts";
import {
  LOGIN_FAILURE_LIMIT,
  SIGN_IN_WINDOW_MS,
  type SignInThrottles,
  sourceAddressKey,
  throttledUntil,
} from "./throttle.ts";
import type { TotpKeyRing } from "./sealed-secrets.ts";
import { useSecondFactor } from "./two-factor.ts";
import { userAccess, type UserAccess } from "./users.ts";

export interface LoginInput {
  readonly storeCode: string;
  readonly login: string;
  readonly password: string;
  /** A code from the authenticator app or a recovery code, for a user with 2FA (rule 26). */
  readonly secondFactor?: string | undefined;
}

export interface PinLoginInput {
  /** Picked from the name tiles of the device. */
  readonly userId: string;
  readonly pin: string;
}

/** Where a sign-in comes from. */
export interface SignInSource {
  /** The request's source address, as the server's trusted proxies report it. */
  readonly address: string;
  /** The credential of the registered device it is made on (`Mustawfi-Device`), if any. */
  readonly deviceCredential?: string | undefined;
}

export interface LoggedIn {
  readonly tenantId: string;
  readonly user: SessionUser;
  /** The bearer token, handed to the client once; only its hash is stored. */
  readonly token: string;
  readonly expiresAt: Date;
  /** The license by the server's clock at sign-in (rule 10). */
  readonly license: LicenseStanding;
}

export type SignInDependencies = AccessDependencies & {
  readonly permissionCatalogue: PermissionCatalogue;
  /** The server process's in-memory counters (`signInThrottles`). */
  readonly throttles: SignInThrottles;
  /** Opens users' sealed TOTP secrets (rule 26). */
  readonly totpKeys: TotpKeyRing;
};

function loginFailed(): ProblemError {
  return new ProblemError(accessProblemCodes.loginFailed, 401, {
    title: "The store code, login, or password is wrong",
  });
}

/** The password is right; the user's two-factor authentication asks for a code (rule 26). */
function secondFactorRequired(): ProblemError {
  return new ProblemError(accessProblemCodes.secondFactorRequired, 401, {
    title: "Two-factor authentication is on: add a code from the app or a recovery code",
  });
}

function secondFactorInvalid(): ProblemError {
  return new ProblemError(accessProblemCodes.secondFactorInvalid, 401, {
    title: "The code from the app or the recovery code is wrong or already used",
  });
}

/** 429 `access.login.throttled` (rule 21). */
export function signInThrottled(until: Date): ProblemError {
  return new ProblemError(accessProblemCodes.loginThrottled, 429, {
    title: "Too many failed sign-ins: wait before trying again",
    detail: `try again after ${until.toISOString()}`,
  });
}

/** The login as typed, normalized the way logins are stored, even when it is not a valid one. */
function typedLogin(login: string): string {
  const parsed = loginSchema.safeParse(login);
  return parsed.success ? parsed.data : login.trim().toLowerCase();
}

/** The store code as typed, normalized the way store codes are resolved. */
function typedStoreCode(storeCode: string): string {
  const parsed = storeCodeSchema.safeParse(storeCode);
  return parsed.success ? parsed.data : storeCode.trim().toUpperCase();
}

/**
 * What failed attempts are counted per (rule 21): the typed login of a password sign-in, or
 * the user and device of an online PIN sign-in.
 */
type AttemptKey =
  | { readonly method: "password"; readonly loginHash: string }
  | { readonly method: "pin"; readonly userId: string; readonly deviceId: string };

function attemptsOf(key: AttemptKey) {
  return key.method === "password"
    ? and(eq(loginAttempts.method, "password"), eq(loginAttempts.loginHash, key.loginHash))
    : and(
        eq(loginAttempts.method, "pin"),
        eq(loginAttempts.userId, key.userId),
        eq(loginAttempts.deviceId, key.deviceId),
      );
}

/** How long a caller is asked to wait when the server is too busy checking its key. */
const BUSY_WAIT_MS = 1000;

/**
 * How long an attempt waits for the attempt of the same key before it (a concurrent sign-in of
 * one login, or a flood of guesses). Beyond it the attempt is refused with 429 rather than
 * holding a database connection in an ever longer queue.
 */
const ATTEMPT_LOCK_TIMEOUT = "5s";

/** The attempts of a key are being checked by too many others: try again in a moment. */
class AttemptsBusy extends Error {
  override name = "AttemptsBusy";
}

/**
 * Takes the attempts of one key in its tenant for this transaction, so parallel guesses are
 * checked one after the other and cannot all pass the check before any of them fails. Waits
 * at most `ATTEMPT_LOCK_TIMEOUT`, then throws `AttemptsBusy` (the transaction rolls back).
 */
async function lockAttempts(tx: TenantTransaction, tenantId: string, key: AttemptKey) {
  const name =
    key.method === "password"
      ? `core_access.login_attempts:${tenantId}:password:${key.loginHash}`
      : `core_access.login_attempts:${tenantId}:pin:${key.userId}:${key.deviceId}`;
  await tx.execute(sql.raw(`set local lock_timeout = '${ATTEMPT_LOCK_TIMEOUT}'`));
  try {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${name}, 0))`);
  } catch (error) {
    if (isLockTimeout(error))
      throw new AttemptsBusy("the attempts of a key are busy", { cause: error });
    throw error;
  }
  await tx.execute(sql.raw("set local lock_timeout to default"));
}

/** Whether `error` is PostgreSQL's `lock_not_available`, through the driver's wrapping. */
function isLockTimeout(error: unknown): boolean {
  for (let e = error; e instanceof Error; e = e.cause) {
    if ((e as { code?: unknown }).code === "55P03") return true;
  }
  return false;
}

/**
 * Runs `fn`, answering an `AttemptsBusy` with 429: the check could not start, which is not a
 * failure of the key.
 */
async function unlessBusy<T>(now: Date, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AttemptsBusy)
      throw signInThrottled(new Date(now.getTime() + BUSY_WAIT_MS));
    throw error;
  }
}

/** Until when `key` is throttled at `now`, from its recent failures. */
async function keyThrottledUntil(
  tx: TenantTransaction,
  key: AttemptKey,
  now: Date,
): Promise<Date | undefined> {
  const since = new Date(now.getTime() - 2 * SIGN_IN_WINDOW_MS);
  const rows = await tx
    .select({ at: loginAttempts.createdAt })
    .from(loginAttempts)
    .where(and(attemptsOf(key), gt(loginAttempts.createdAt, since)))
    .orderBy(desc(loginAttempts.createdAt))
    .limit(LOGIN_FAILURE_LIMIT);
  return throttledUntil(
    rows.map((row) => row.at),
    LOGIN_FAILURE_LIMIT,
    SIGN_IN_WINDOW_MS,
    now,
  );
}

/**
 * Records a failure of `key` and prunes the tenant's failures too old to matter. Returns
 * until when the key is now throttled when this failure reached the limit — the start of a
 * window, audited once (rule 21).
 */
async function recordFailure(
  tx: TenantTransaction,
  at: { readonly tenantId: string; readonly branchId: string; readonly now: Date },
  key: AttemptKey,
  dependencies: AccessDependencies,
): Promise<Date | undefined> {
  await tx
    .delete(loginAttempts)
    .where(lte(loginAttempts.createdAt, new Date(at.now.getTime() - 2 * SIGN_IN_WINDOW_MS)));
  await tx.insert(loginAttempts).values({
    id: dependencies.newId(),
    tenantId: at.tenantId,
    branchId: at.branchId,
    createdAt: at.now,
    createdBy: null,
    ...(key.method === "password"
      ? { method: "password", loginHash: key.loginHash }
      : { method: "pin", userId: key.userId, deviceId: key.deviceId }),
  });
  return keyThrottledUntil(tx, key, at.now);
}

/** A success clears the key's failures: the limit is for guesses, not for typos. */
async function clearFailures(tx: TenantTransaction, key: AttemptKey): Promise<void> {
  await tx.delete(loginAttempts).where(attemptsOf(key));
}

/** Clears the failed password sign-ins of `login` in `tx`'s tenant (a support reset). */
export async function clearLoginFailures(tx: TenantTransaction, login: string): Promise<void> {
  await clearFailures(tx, { method: "password", loginHash: sha256Hex(typedLogin(login)) });
}

/**
 * Refuses a source address past its limit with 429, audited once per window in the store the
 * refused attempt named (the address may have tried several).
 */
export async function refuseThrottledAddress(
  tenants: TenantDatabase,
  source: SignInSource,
  tenantId: string | undefined,
  dependencies: SignInDependencies,
): Promise<void> {
  const now = dependencies.clock.now();
  const { addresses } = dependencies.throttles;
  const address = sourceAddressKey(source.address);
  const until = addresses.throttledUntil(address, now);
  if (until === undefined) {
    if (addresses.busy(address, now)) {
      throw signInThrottled(new Date(now.getTime() + BUSY_WAIT_MS));
    }
    return;
  }
  if (tenantId !== undefined && addresses.firstRefusal(address, tenantId, until, now)) {
    await tenants.withTenant({ tenantId }, async (tx) => {
      const tenant = await currentTenant(tx);
      if (tenant === undefined) throw new Error(`tenant ${tenantId} has a store code but no row`);
      await recordAudit(tx, {
        id: dependencies.newId(),
        tenantId,
        branchId: tenant.defaultBranchId,
        occurredAt: now,
        userId: null,
        action: "access.login.throttled",
        after: { scope: "address", address, until: until.toISOString() },
      });
    });
  }
  throw signInThrottled(until);
}

/**
 * The device a sign-in is made on: none without a credential, a 401 for a bad one, and a 401
 * `access.device.revoked` for a revoked one (rule 23).
 */
async function presentedDevice(
  tenants: TenantDatabase,
  source: SignInSource,
): Promise<Device | undefined> {
  if (source.deviceCredential === undefined) return undefined;
  const device = await authenticateDevice(tenants, source.deviceCredential);
  if (device === undefined) throw deviceRequired();
  if (device.revokedAt !== null) throw deviceRevoked();
  return device;
}

/** The refusals that count as failed guesses against the source address. */
const GUESS_FAILURES = new Set<string>([
  accessProblemCodes.loginFailed,
  accessProblemCodes.secondFactorInvalid,
  accessProblemCodes.resetCodeInvalid,
]);

/**
 * Runs one sign-in attempt counted against the source address: it counts as a failure when it
 * ends in a wrong guess (`access.login.failed`, `access.resetCode.invalid`), and not when it
 * succeeds or is refused before any check.
 */
export async function countedByAddress<T>(
  source: SignInSource,
  dependencies: SignInDependencies,
  attempt: () => Promise<T>,
): Promise<T> {
  const counted = dependencies.throttles.addresses.begin(
    sourceAddressKey(source.address),
    dependencies.clock.now(),
  );
  try {
    const result = await attempt();
    counted.release();
    return result;
  } catch (error) {
    if (error instanceof ProblemError && GUESS_FAILURES.has(error.code)) {
      counted.fail();
    } else {
      counted.release();
    }
    throw error;
  }
}

interface VerifiedUser {
  readonly id: string;
  readonly branchId: string;
  readonly name: string;
  readonly login: string | null;
}

/**
 * The access of a user whose credentials were just verified, or 403 `tenancy.license.suspended`
 * when the license is suspended and they are not an owner (rule 5). Not a failed sign-in:
 * nothing is counted or audited. Password sign-in asks before a second factor is used up.
 */
async function admittedAccess(
  tx: TenantTransaction,
  userId: string,
  now: Date,
  dependencies: SignInDependencies,
): Promise<{ readonly access: UserAccess; readonly license: LicenseStanding }> {
  const access = await userAccess(tx, userId, dependencies.permissionCatalogue);
  if (access === undefined) throw new Error(`user ${userId} vanished during sign-in`);
  const status = await currentLicenseStatus(tx, now);
  if (!access.role.isOwner && status.state === "suspended") throw licenseSuspended();
  return { access, license: licenseStanding(status.license.claims, status.state) };
}

/** How a sign-in was proved: its method, and the second factor of a password sign-in. */
interface SignInProof {
  readonly method: "password" | "pin";
  readonly device: Device | undefined;
  readonly secondFactor?: "totp" | "recoveryCode" | undefined;
}

/**
 * Opens the session of a verified sign-in, audited `access.login.succeeded`. While the license
 * is suspended, only an owner's (403 `tenancy.license.suspended` otherwise, rule 5).
 */
async function openAuditedSession(
  tenants: TenantDatabase,
  tenantId: string,
  user: VerifiedUser,
  how: SignInProof,
  dependencies: SignInDependencies,
): Promise<LoggedIn> {
  const now = dependencies.clock.now();
  const deviceId = how.device?.deviceId;
  const session = await tenants.withTenant(
    { tenantId, userId: user.id, ...(deviceId === undefined ? {} : { deviceId }) },
    async (tx) => {
      const { access, license } = await admittedAccess(tx, user.id, now, dependencies);
      const opened = await openSession(
        tx,
        {
          tenantId,
          branchId: user.branchId,
          userId: user.id,
          method: how.method,
          ...(deviceId === undefined ? {} : { deviceId }),
        },
        dependencies,
      );
      await recordAudit(tx, {
        id: dependencies.newId(),
        tenantId,
        branchId: user.branchId,
        occurredAt: now,
        userId: user.id,
        ...(deviceId === undefined ? {} : { deviceId }),
        action: "access.login.succeeded",
        entity: { type: "access.session", id: opened.sessionId },
        after: {
          login: user.login,
          method: how.method,
          ...(how.secondFactor === undefined ? {} : { secondFactor: how.secondFactor }),
        },
      });
      return { ...opened, access, license };
    },
  );
  return {
    tenantId,
    user: sessionUser(user, session.access, dependencies.permissionCatalogue).user,
    token: session.token,
    expiresAt: session.expiresAt,
    license: session.license,
  };
}

/**
 * Password sign-in (ADR-0022): the store code names the tenant (ADR-0029), the login the
 * user, and the password is checked against its Argon2id hash. Success opens a session; every
 * attempt within a known store is audited, success or not. Every failure is the same 401
 * `access.login.failed` and takes about as long, so a caller cannot tell an unknown store or
 * login from a wrong password.
 *
 * Rate limits (rule 21): five failures of one store and login within fifteen minutes make that
 * login wait fifteen minutes, whether the login exists or not, and so do five failures of one
 * unknown store code and login; thirty failures from one source address make the address wait.
 * The answer is 429 `access.login.throttled`, audited once per window.
 *
 * Made on a registered device (its credential in `source`), the session is bound to it (rule
 * 22), and only the device's own store accepts the sign-in: another store code is answered
 * like an unknown one. A credential that is not a device's is a 401 `access.device.required`.
 *
 * A user with two-factor authentication (rule 26) also needs `secondFactor`: without it, the
 * right password is answered 401 `access.login.secondFactorRequired` (not a failure); a wrong
 * or replayed code, or a used recovery code, is 401 `access.login.secondFactorInvalid` and
 * counts as a failed sign-in of the login and the address. A recovery code used is audited
 * `access.twoFactor.recoveryCodeUsed` with how many are left.
 */
export async function logIn(
  tenants: TenantDatabase,
  input: LoginInput,
  source: SignInSource,
  dependencies: SignInDependencies,
): Promise<LoggedIn> {
  const storeTenantId = await tenants.resolveStoreCode(input.storeCode);
  await refuseThrottledAddress(tenants, source, storeTenantId, dependencies);
  const device = await presentedDevice(tenants, source);
  const tenantId =
    device === undefined || device.tenantId === storeTenantId ? storeTenantId : undefined;
  const login = typedLogin(input.login);

  const user = await countedByAddress(source, dependencies, async () => {
    const now = dependencies.clock.now();
    if (tenantId === undefined) {
      const { unknownStores } = dependencies.throttles;
      const key = `${typedStoreCode(input.storeCode)}\n${login}`;
      const until = unknownStores.throttledUntil(key, now);
      if (until !== undefined) throw signInThrottled(until);
      if (unknownStores.busy(key, now)) {
        throw signInThrottled(new Date(now.getTime() + BUSY_WAIT_MS));
      }
      const counted = unknownStores.begin(key, now);
      try {
        await verifyNothing(input.password);
      } catch (error) {
        counted.release();
        throw error;
      }
      counted.fail();
      throw loginFailed();
    }

    const key: AttemptKey = { method: "password", loginHash: sha256Hex(login) };
    const checked = await unlessBusy(now, () =>
      tenants.withTenant({ tenantId }, async (tx) => {
        const tenant = await currentTenant(tx);
        if (tenant === undefined) throw new Error(`tenant ${tenantId} has a store code but no row`);
        await lockAttempts(tx, tenantId, key);
        const until = await keyThrottledUntil(tx, key, now);
        if (until !== undefined) return { throttled: until } as const;

        const [found] = loginSchema.safeParse(input.login).success
          ? await tx
              .select({
                id: users.id,
                branchId: users.branchId,
                name: users.name,
                login: users.login,
                passwordHash: users.passwordHash,
                status: users.status,
                tenantId: users.tenantId,
                totpSecret: users.totpSecret,
                totpEnabledAt: users.totpEnabledAt,
              })
              .from(users)
              .where(eq(users.login, login))
          : [];
        // A deactivated user, or one without a password (PIN only), fails like a wrong password.
        const passwordHash = found?.status === "active" ? found.passwordHash : null;
        const verified =
          passwordHash === null
            ? await verifyNothing(input.password).then(() => false)
            : await verifyPassword(passwordHash, input.password);
        // Before a second factor is used up: a suspended store turns non-owners away (rule 5).
        if (found !== undefined && verified) await admittedAccess(tx, found.id, now, dependencies);
        let secondFactor: "totp" | "recoveryCode" | undefined;
        if (found !== undefined && verified && found.totpEnabledAt !== null) {
          if (input.secondFactor === undefined || input.secondFactor.trim() === "") {
            return { secondFactorRequired: true } as const;
          }
          const factor = await useSecondFactor(tx, found, input.secondFactor, now, dependencies);
          if (factor?.kind === "recoveryCode") {
            await recordAudit(tx, {
              id: dependencies.newId(),
              tenantId,
              branchId: found.branchId,
              occurredAt: now,
              userId: found.id,
              ...(device === undefined ? {} : { deviceId: device.deviceId }),
              action: "access.twoFactor.recoveryCodeUsed",
              entity: { type: "access.user", id: found.id },
              after: { recoveryCodeId: factor.id, remaining: factor.remaining },
            });
          }
          secondFactor = factor?.kind;
        }
        const secondFactorFailed =
          verified &&
          found !== undefined &&
          found.totpEnabledAt !== null &&
          secondFactor === undefined;
        if (found !== undefined && verified && !secondFactorFailed) {
          await clearFailures(tx, key);
          return { user: found, secondFactor } as const;
        }

        const branchId = found?.branchId ?? tenant.defaultBranchId;
        const throttledFrom = await recordFailure(
          tx,
          { tenantId, branchId, now },
          key,
          dependencies,
        );
        const entry = {
          tenantId,
          branchId,
          occurredAt: now,
          userId: null,
          ...(device === undefined ? {} : { deviceId: device.deviceId }),
          // The typed text is not kept: people type passwords into the login field by mistake.
          ...(found === undefined ? {} : { entity: { type: "access.user", id: found.id } }),
        };
        await recordAudit(tx, {
          ...entry,
          id: dependencies.newId(),
          action: "access.login.failed",
          ...(secondFactorFailed ? { after: { secondFactor: "invalid" } } : {}),
        });
        if (throttledFrom !== undefined) {
          await recordAudit(tx, {
            ...entry,
            id: dependencies.newId(),
            action: "access.login.throttled",
            after: { scope: "login", until: throttledFrom.toISOString() },
          });
        }
        return secondFactorFailed
          ? ({ secondFactorFailed: true } as const)
          : ({ failed: true } as const);
      }),
    );
    if ("throttled" in checked) throw signInThrottled(checked.throttled);
    if ("failed" in checked) throw loginFailed();
    if ("secondFactorRequired" in checked) throw secondFactorRequired();
    if ("secondFactorFailed" in checked) throw secondFactorInvalid();
    return checked;
  });

  if (tenantId === undefined) throw new Error("a sign-in verified without a store");
  return openAuditedSession(
    tenants,
    tenantId,
    user.user,
    { method: "password", device, secondFactor: user.secondFactor },
    dependencies,
  );
}

/**
 * Online PIN sign-in on a registered device (rules 20–22): the device's credential in `source`
 * names the store, the user is picked by id, and the PIN is checked against their verifier.
 * The session is bound to the device. Five failures of one user on one device within fifteen
 * minutes make that user wait there (429 `access.login.throttled`, audited once per window);
 * the source address counts as for password sign-in. An unknown, deactivated, or PIN-less
 * user fails like a wrong PIN.
 */
export async function logInWithPin(
  tenants: TenantDatabase,
  input: PinLoginInput,
  source: SignInSource,
  dependencies: SignInDependencies,
): Promise<LoggedIn> {
  const device = await presentedDevice(tenants, source);
  if (device === undefined) throw deviceRequired();
  const { tenantId, deviceId } = device;
  await refuseThrottledAddress(tenants, source, tenantId, dependencies);

  const user = await countedByAddress(source, dependencies, async () => {
    const now = dependencies.clock.now();
    const key: AttemptKey = { method: "pin", userId: input.userId, deviceId };
    const checked = await unlessBusy(now, () =>
      tenants.withTenant({ tenantId, deviceId }, async (tx) => {
        const [found] = await tx
          .select({
            id: users.id,
            branchId: users.branchId,
            name: users.name,
            login: users.login,
            pinVerifier: users.pinVerifier,
            status: users.status,
          })
          .from(users)
          .where(eq(users.id, input.userId));
        const failure = {
          tenantId,
          branchId: found?.branchId ?? device.branchId,
          occurredAt: now,
          userId: null,
          deviceId,
        };
        if (found === undefined) {
          // Nothing to count against: the attempts of a user are kept with the user.
          await verifyNothing(input.pin);
          await recordAudit(tx, {
            ...failure,
            id: dependencies.newId(),
            action: "access.login.failed",
            after: { method: "pin" },
          });
          return { failed: true } as const;
        }

        await lockAttempts(tx, tenantId, key);
        const until = await keyThrottledUntil(tx, key, now);
        if (until !== undefined) return { throttled: until } as const;
        const pinVerifier = found.status === "active" ? found.pinVerifier : null;
        const verified =
          pinVerifier === null
            ? await verifyNothing(input.pin).then(() => false)
            : await verifyPassword(pinVerifier, input.pin);
        if (verified) {
          await clearFailures(tx, key);
          return { user: found } as const;
        }

        const throttledFrom = await recordFailure(
          tx,
          { tenantId, branchId: found.branchId, now },
          key,
          dependencies,
        );
        const entity = { type: "access.user", id: found.id };
        await recordAudit(tx, {
          ...failure,
          id: dependencies.newId(),
          action: "access.login.failed",
          entity,
          after: { method: "pin" },
        });
        if (throttledFrom !== undefined) {
          await recordAudit(tx, {
            ...failure,
            id: dependencies.newId(),
            action: "access.login.throttled",
            entity,
            after: { scope: "pin", until: throttledFrom.toISOString() },
          });
        }
        return { failed: true } as const;
      }),
    );
    if ("throttled" in checked) throw signInThrottled(checked.throttled);
    if ("failed" in checked) throw loginFailed();
    return checked.user;
  });

  return openAuditedSession(tenants, tenantId, user, { method: "pin", device }, dependencies);
}
