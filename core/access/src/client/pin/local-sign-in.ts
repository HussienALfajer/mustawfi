import type { AuditSink, LoadedBundle } from "@mustawfi/core-config/client";
import type { Clock } from "@mustawfi/kernel";
import {
  type LocalDb,
  type LocalExecutor,
  type LocalMigration,
  localOrm,
  safeInteger,
} from "@mustawfi/local-db";
import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  ACCESS_BUNDLE_PART,
  type AccessPart,
  PIN_ATTEMPTS,
  PIN_DEVICE_EVENTS,
  UNLOCK_PERMISSION,
} from "../../shared/index.ts";

/**
 * PIN sign-in on the device (ADR-0022, `core-foundation` rules 20 and 24): who is signed in on
 * it, and the wrong PINs counted per user while the server is out of reach. Both live in the
 * local database, so a restart changes neither: a lockout survives it, and a session left idle
 * is over when the app opens again.
 */

/** The wrong PINs of one user on this device, checked without the server. */
const pinLockouts = sqliteTable("access_pin_lockouts", {
  userId: text("user_id").primaryKey(),
  /** Wrong PINs in a row since the last right one. */
  failures: safeInteger().notNull(),
  /** When the user was locked out (the fifth wrong PIN); null while they are not. */
  lockedAt: text("locked_at"),
  /**
   * The `pinChangedAt` of the verifier the failures were counted against: a PIN set again since
   * (a manager's reset, in a newer bundle) starts the count over — the bundle's lockout reset
   * marker.
   */
  pinChangedAt: text("pin_changed_at"),
});

/** The user signed in on this device: at most one row. */
const localSessionTable = sqliteTable("access_local_session", {
  id: integer().primaryKey(),
  userId: text("user_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  method: text().$type<LocalSessionMethod>().notNull(),
  openedAt: text("opened_at").notNull(),
  /** Whether the sign-in opened a server session for this user; else it was checked offline. */
  serverSession: integer("server_session", { mode: "boolean" }).notNull(),
});

/**
 * The last input on this device, in epoch milliseconds: kept apart from the session, so the
 * frequent writes wake no query that reads who is signed in.
 */
const sessionActivity = sqliteTable("access_session_activity", {
  id: integer().primaryKey(),
  lastActivityAt: safeInteger("last_activity_at").notNull(),
});

export const PIN_LOCKOUT_TABLE = "access_pin_lockouts";
export const LOCAL_SESSION_TABLE = "access_local_session";

/** PIN sign-in's local schema, appended at the end of the app's list (ADR-0019). */
export const pinLocalMigrations: readonly LocalMigration[] = [
  {
    id: "core.access.0002_pin_sign_in",
    statements: [
      `CREATE TABLE access_pin_lockouts (
        user_id TEXT PRIMARY KEY,
        failures INTEGER NOT NULL CHECK (failures >= 0),
        locked_at TEXT,
        pin_changed_at TEXT
      ) STRICT`,
      `CREATE TABLE access_local_session (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        user_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        method TEXT NOT NULL CHECK (method IN ('pin', 'password')),
        opened_at TEXT NOT NULL,
        server_session INTEGER NOT NULL CHECK (server_session IN (0, 1))
      ) STRICT`,
      `CREATE TABLE access_session_activity (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_activity_at INTEGER NOT NULL
      ) STRICT`,
    ],
  },
];

export type LocalSessionMethod = "pin" | "password";

export interface LocalSession {
  readonly userId: string;
  readonly tenantId: string;
  readonly method: LocalSessionMethod;
  readonly openedAt: string;
  readonly serverSession: boolean;
}

/** The user signed in on this device, if any, idle or not. */
export async function localSession(executor: LocalExecutor): Promise<LocalSession | undefined> {
  const row = await localOrm(executor).select().from(localSessionTable).get();
  if (row === undefined) return undefined;
  return {
    userId: row.userId,
    tenantId: row.tenantId,
    method: row.method,
    openedAt: row.openedAt,
    serverSession: row.serverSession,
  };
}

/** The last input recorded on this device, in epoch milliseconds. */
export async function lastActivityAt(executor: LocalExecutor): Promise<number | undefined> {
  const row = await localOrm(executor).select().from(sessionActivity).get();
  return row?.lastActivityAt;
}

/** Records input now: the idle time counts from here (rule 24). */
export async function recordActivity(executor: LocalExecutor, now: Date): Promise<void> {
  const at = now.getTime();
  await localOrm(executor)
    .insert(sessionActivity)
    .values({ id: 1, lastActivityAt: at })
    .onConflictDoUpdate({ target: sessionActivity.id, set: { lastActivityAt: at } });
}

/**
 * Whether the session has been idle for `idleMs` at `now`: no input recorded, or none within
 * the idle time. A clock moved back by more than the idle time counts as idle too, so moving it
 * cannot keep a session open.
 */
export function isIdle(lastActivity: number | undefined, now: Date, idleMs: number): boolean {
  if (lastActivity === undefined) return true;
  return Math.abs(now.getTime() - lastActivity) >= idleMs;
}

/** Opens `userId`'s session on this device, in place of any other, as input now. */
export async function openLocalSession(
  tx: LocalExecutor,
  session: Omit<LocalSession, "openedAt">,
  now: Date,
): Promise<void> {
  const row = { id: 1, ...session, openedAt: now.toISOString() };
  await localOrm(tx)
    .insert(localSessionTable)
    .values(row)
    .onConflictDoUpdate({ target: localSessionTable.id, set: row });
  await recordActivity(tx, now);
}

/** Records that the signed-in user now has a server session too (rule 25). */
export async function attachServerSession(tx: LocalExecutor, userId: string): Promise<void> {
  await localOrm(tx)
    .update(localSessionTable)
    .set({ serverSession: true })
    .where(eq(localSessionTable.userId, userId));
}

/** Ends the session on this device: a lock, a user switch, or a sign-out. */
export async function endLocalSession(executor: LocalExecutor): Promise<void> {
  await localOrm(executor).delete(localSessionTable);
}

/** The bundle's `access` part this device uses: a valid bundle's, or the previous one kept. */
export function accessPartOf(loaded: LoadedBundle): AccessPart | undefined {
  const bundle = loaded.state === "none" ? undefined : loaded.bundle;
  return bundle?.parts[ACCESS_BUNDLE_PART] as AccessPart | undefined;
}

export type BundleUser = AccessPart["users"][number];
export type BundleRole = AccessPart["roles"][number];

/** A user of the bundle and their role; the decoder made sure every user has one. */
export function bundleUser(
  access: AccessPart,
  userId: string,
): { readonly user: BundleUser; readonly role: BundleRole } | undefined {
  const user = access.users.find((candidate) => candidate.id === userId);
  const role = access.roles.find((candidate) => candidate.id === user?.roleId);
  return user === undefined || role === undefined ? undefined : { user, role };
}

/** Whether a user's role may unlock others on the device: the owner, or `access.users.unlock`. */
export function mayUnlock(role: BundleRole): boolean {
  return role.isOwner || role.permissions.includes(UNLOCK_PERMISSION);
}

export interface PinLockout {
  readonly failures: number;
  readonly lockedAt: string | null;
}

/**
 * A user's wrong PINs on this device against their current verifier: none once the bundle
 * carries a PIN set after they were counted.
 */
async function currentLockout(
  executor: LocalExecutor,
  user: BundleUser,
): Promise<PinLockout | undefined> {
  const row = await localOrm(executor)
    .select()
    .from(pinLockouts)
    .where(eq(pinLockouts.userId, user.id))
    .get();
  if (row === undefined || row.pinChangedAt !== user.pinChangedAt) return undefined;
  return { failures: row.failures, lockedAt: row.lockedAt };
}

/** Every user locked out on this device, by user id, against the bundle's verifiers. */
export async function lockedOutUsers(
  executor: LocalExecutor,
  access: AccessPart,
): Promise<ReadonlySet<string>> {
  const rows = await localOrm(executor).select().from(pinLockouts).all();
  const locked = new Set<string>();
  for (const row of rows) {
    const user = access.users.find((candidate) => candidate.id === row.userId);
    if (user !== undefined && row.lockedAt !== null && row.pinChangedAt === user.pinChangedAt) {
      locked.add(row.userId);
    }
  }
  return locked;
}

/** Forgets a user's wrong PINs on this device: a right PIN, online or not, or an unlock. */
export async function clearPinFailures(tx: LocalExecutor, userId: string): Promise<void> {
  await localOrm(tx).delete(pinLockouts).where(eq(pinLockouts.userId, userId));
}

/** Checks a PIN against an Argon2id verifier (a PHC string); a malformed one never matches. */
export type PinCheck = (verifier: string, pin: string) => Promise<boolean>;

export interface LocalPinDependencies {
  readonly clock: Clock;
  readonly audit: AuditSink;
  readonly checkPin: PinCheck;
}

/** What a PIN checked on the device came to. */
export type LocalPinOutcome =
  | { readonly outcome: "verified" }
  /** Wrong: `attemptsLeft` before the user is locked out on this device. */
  | { readonly outcome: "wrongPin"; readonly attemptsLeft: number }
  /** Wrong, and it was the last attempt: the user is now locked out on this device. */
  | { readonly outcome: "lockedOut" }
  /** The user was already locked out: the PIN was not checked. */
  | { readonly outcome: "locked" }
  /** Not in the bundle, or without a PIN: nobody to check against. */
  | { readonly outcome: "unavailable" };

/**
 * Checks `pin` for `userId` against the bundle's verifier (rule 20): a right PIN clears their
 * count; a wrong one adds to it, and the fifth locks them out on this device — until a
 * supervisor unlocks them here, or the device reaches the server. A locked-out user's PIN is not
 * checked. Each failure and the lockout are audited on the device path, in the transaction that
 * counts them. Only the count is written here; the caller does what a right PIN is for.
 */
export async function checkPinLocally(
  db: LocalDb,
  access: AccessPart,
  userId: string,
  pin: string,
  dependencies: LocalPinDependencies,
  onVerified: (tx: LocalExecutor) => Promise<void>,
): Promise<LocalPinOutcome> {
  const found = bundleUser(access, userId);
  const verifier = found?.user.pinVerifier ?? null;
  if (found === undefined || verifier === null) return { outcome: "unavailable" };
  const { user } = found;
  if ((await currentLockout(db, user))?.lockedAt != null) return { outcome: "locked" };
  // Hashing takes a while: outside the transaction, which then checks the count again.
  const verified = await dependencies.checkPin(verifier, pin);
  return db.transaction(async (tx): Promise<LocalPinOutcome> => {
    const lockout = await currentLockout(tx, user);
    if (lockout?.lockedAt != null) return { outcome: "locked" };
    if (verified) {
      await clearPinFailures(tx, user.id);
      await onVerified(tx);
      return { outcome: "verified" };
    }
    const failures = (lockout?.failures ?? 0) + 1;
    const now = dependencies.clock.now();
    const lockedAt = failures >= PIN_ATTEMPTS ? now.toISOString() : null;
    const row = { userId: user.id, failures, lockedAt, pinChangedAt: user.pinChangedAt };
    await localOrm(tx)
      .insert(pinLockouts)
      .values(row)
      .onConflictDoUpdate({ target: pinLockouts.userId, set: row });
    const entity = { type: "access.user", id: user.id };
    await dependencies.audit.record(tx, {
      action: PIN_DEVICE_EVENTS.failed.action,
      userId: user.id,
      entity,
      after: { failures },
    });
    if (lockedAt === null) return { outcome: "wrongPin", attemptsLeft: PIN_ATTEMPTS - failures };
    await dependencies.audit.record(tx, {
      action: PIN_DEVICE_EVENTS.lockedOut.action,
      userId: user.id,
      entity,
      after: { failures, lockedAt },
    });
    return { outcome: "lockedOut" };
  });
}

/**
 * Signs `userId` in on this device without the server (flow 12): the PIN is checked against the
 * bundle (rule 20), and a right one opens their session here — with no server session, which the
 * first action needing the server asks for (rule 25). Audited on the device path.
 */
export async function signInLocally(
  db: LocalDb,
  access: AccessPart,
  device: { readonly tenantId: string },
  input: { readonly userId: string; readonly pin: string },
  dependencies: LocalPinDependencies,
): Promise<LocalPinOutcome> {
  return checkPinLocally(db, access, input.userId, input.pin, dependencies, async (tx) => {
    const now = dependencies.clock.now();
    await openLocalSession(
      tx,
      { userId: input.userId, tenantId: device.tenantId, method: "pin", serverSession: false },
      now,
    );
    await dependencies.audit.record(tx, {
      action: PIN_DEVICE_EVENTS.signedIn.action,
      userId: input.userId,
      entity: { type: "access.user", id: input.userId },
      after: { method: "pin" },
    });
  });
}

/** What a supervisor's unlock came to. */
export type UnlockOutcome =
  | Exclude<LocalPinOutcome, { readonly outcome: "verified" }>
  /** The supervisor's PIN was right and the user is unlocked. */
  | { readonly outcome: "unlocked" }
  /** The supervisor's role may not unlock (rule 20: `access.users.unlock`). */
  | { readonly outcome: "notAllowed" }
  /** The user is not locked out on this device (any more). */
  | { readonly outcome: "notLocked" };

/**
 * A supervisor unlocks `lockedUserId` on this device (flow 13): their role must hold
 * `access.users.unlock` (the owner does), and their PIN is checked on the device like any PIN —
 * a wrong one counts against the supervisor. Audited on the device path as the supervisor's.
 */
export async function unlockUser(
  db: LocalDb,
  access: AccessPart,
  input: {
    readonly lockedUserId: string;
    readonly supervisorId: string;
    readonly pin: string;
  },
  dependencies: LocalPinDependencies,
): Promise<UnlockOutcome> {
  const supervisor = bundleUser(access, input.supervisorId);
  const locked = bundleUser(access, input.lockedUserId);
  if (supervisor === undefined || locked === undefined) return { outcome: "unavailable" };
  if (input.supervisorId === input.lockedUserId || !mayUnlock(supervisor.role)) {
    return { outcome: "notAllowed" };
  }
  const unlocked = { done: false };
  const outcome = await checkPinLocally(
    db,
    access,
    input.supervisorId,
    input.pin,
    dependencies,
    async (tx) => {
      const lockout = await currentLockout(tx, locked.user);
      if (lockout?.lockedAt == null) return;
      unlocked.done = true;
      await clearPinFailures(tx, locked.user.id);
      await dependencies.audit.record(tx, {
        action: PIN_DEVICE_EVENTS.unlocked.action,
        userId: input.supervisorId,
        entity: { type: "access.user", id: locked.user.id },
        before: { failures: lockout.failures, lockedAt: lockout.lockedAt },
      });
    },
  );
  if (outcome.outcome !== "verified") return outcome;
  return unlocked.done ? { outcome: "unlocked" } : { outcome: "notLocked" };
}
