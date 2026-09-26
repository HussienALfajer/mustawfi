import { ProblemError } from "@mustawfi/core-config/server";
import type { PermissionCatalogue } from "@mustawfi/core-config/shared";
import {
  activeDepartments,
  currentLicense,
  lockTenant,
  type TenantTransaction,
} from "@mustawfi/core-tenancy/server";
import { tenancyProblemCodes } from "@mustawfi/core-tenancy/shared";
import type { IdGenerator } from "@mustawfi/kernel";
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import {
  accessProblemCodes,
  type DepartmentScope,
  loginSchema,
  type RoleAccess,
  userNameSchema,
  type UserStatus,
  type UserView,
} from "../shared/index.ts";
import { auditAs, checkGrantable, type Manager, type RoleActor, violates } from "./actor.ts";
import type { AccessDependencies } from "./dependencies.ts";
import { hashPassword, hashPin, verifyPassword } from "./passwords.ts";
import { activeRole, holdingsOf } from "./roles.ts";
import { roles, sessions, userDepartments, users } from "./schema.ts";
import { clearTwoFactor } from "./two-factor.ts";

export interface NewUser {
  readonly id: string;
  readonly tenantId: string;
  readonly branchId: string;
  readonly name: string;
  /** Absent for a user who signs in only by PIN; required with a password. */
  readonly login: string | null;
  /** From `hashPassword`; optional (rule 19). */
  readonly passwordHash: string | null;
  /** From `hashPin`; absent only for a tenant's first owner. */
  readonly pinVerifier?: string;
  /** An active role of the tenant. */
  readonly roleId: string;
  /** Every department, or the listed ones; an owner's is always `all`. */
  readonly departmentScope: "all" | { readonly listed: readonly string[] };
  readonly createdAt: Date;
  readonly createdBy: string;
}

const ARGON2ID_PREFIX = "$argon2id$";

/**
 * Creates a user in `tx`, a `withTenant` transaction for `tenantId`, with their role and
 * department scope. The caller checks the rules and audits it: the tenant's creation for its
 * first owner, `addUser` for everyone else.
 */
export async function createUser(
  tx: TenantTransaction,
  user: NewUser,
  dependencies: { readonly newId: IdGenerator },
): Promise<void> {
  const name = userNameSchema.parse(user.name);
  const login = user.login === null ? null : loginSchema.parse(user.login);
  if (user.passwordHash !== null && !user.passwordHash.startsWith(ARGON2ID_PREFIX)) {
    throw new TypeError("passwordHash must be an Argon2id hash from hashPassword");
  }
  if (user.pinVerifier !== undefined && !user.pinVerifier.startsWith(ARGON2ID_PREFIX)) {
    throw new TypeError("pinVerifier must be an Argon2id hash from hashPin");
  }
  if (user.passwordHash !== null && login === null) {
    throw new TypeError("a user with a password needs a login");
  }
  const role = await activeRole(tx, user.roleId);
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
    status: "active",
    pinVerifier: user.pinVerifier ?? null,
    pinChangedAt: user.pinVerifier === undefined ? null : user.createdAt,
  });
  await insertListed(tx, user, user.id, listed, dependencies);
}

/** Lists `listed` as `userId`'s departments; the user must list none yet. */
async function insertListed(
  tx: TenantTransaction,
  stamp: {
    readonly tenantId: string;
    readonly branchId: string;
    readonly createdAt: Date;
    readonly createdBy: string;
  },
  userId: string,
  listed: readonly string[],
  dependencies: { readonly newId: IdGenerator },
): Promise<void> {
  if (listed.length === 0) return;
  await tx.insert(userDepartments).values(
    listed.map((departmentId) => ({
      id: dependencies.newId(),
      tenantId: stamp.tenantId,
      branchId: stamp.branchId,
      createdAt: stamp.createdAt,
      createdBy: stamp.createdBy,
      userId,
      departmentId,
    })),
  );
}

/** A user with their role, as sessions and sync ingest resolve them. */
export interface UserAccess {
  readonly role: { readonly id: string; readonly name: string; readonly isOwner: boolean };
  readonly access: RoleAccess;
}

/**
 * The role, permissions, limits, and scope of `userId` in the current `withTenant` context, or
 * `undefined` when the tenant has no such user. Sessions resolve their user with it, and sync
 * checks the user each operation names (ADR-0022). A role seeded from a template also holds
 * the template grants declared since it was last edited (`roleHoldings`). Archived departments
 * leave a listed scope (`core-foundation` rule 28). A deactivated user resolves too: the
 * documents a device made before it heard are still checked against their role.
 */
export async function userAccess(
  tx: TenantTransaction,
  userId: string,
  catalogue: PermissionCatalogue,
): Promise<UserAccess | undefined> {
  const [row] = await tx
    .select({ role: roles, departmentScope: users.departmentScope })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.id, userId));
  if (row === undefined) return undefined;
  const role = { id: row.role.id, name: row.role.name, isOwner: row.role.isOwner };
  const departmentScope = row.departmentScope === "listed" ? "listed" : "all";
  if (row.role.isOwner) {
    return {
      role,
      access: { isOwner: true, permissions: [], limits: {}, departmentScope, departments: [] },
    };
  }
  const holdings = await holdingsOf(tx, row.role, catalogue);
  const departments =
    departmentScope === "listed" ? ((await scopesOf(tx, [userId])).get(userId) ?? []) : [];
  return {
    role,
    access: {
      isOwner: false,
      permissions: holdings.permissions,
      limits: holdings.limits,
      departmentScope,
      departments,
    },
  };
}

/** The active listed departments of each of `userIds` (rule 28: archived ones leave). */
async function scopesOf(
  tx: TenantTransaction,
  userIds: readonly string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (userIds.length === 0) return result;
  const listed = await tx
    .select({ userId: userDepartments.userId, departmentId: userDepartments.departmentId })
    .from(userDepartments)
    .where(inArray(userDepartments.userId, [...userIds]))
    .orderBy(asc(userDepartments.createdAt), asc(userDepartments.id));
  const active = await activeDepartments(
    tx,
    listed.map((l) => l.departmentId),
  );
  for (const { userId, departmentId } of listed) {
    if (!active.has(departmentId)) continue;
    result.set(userId, [...(result.get(userId) ?? []), departmentId]);
  }
  return result;
}

type UserRow = typeof users.$inferSelect;
type RoleRow = typeof roles.$inferSelect;

function toView(user: UserRow, role: RoleRow, departments: readonly string[]): UserView {
  return {
    id: user.id,
    name: user.name,
    login: user.login,
    role: { id: role.id, name: role.name, isOwner: role.isOwner },
    departmentScope: user.departmentScope === "listed" ? "listed" : "all",
    departments: user.departmentScope === "listed" ? [...departments] : [],
    status: user.status === "deactivated" ? "deactivated" : "active",
    hasPassword: user.passwordHash !== null,
    hasPin: user.pinVerifier !== null,
    twoFactorEnabled: user.totpEnabledAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

/** The tenant's users, deactivated ones included, by name. */
export async function listUsers(tx: TenantTransaction): Promise<UserView[]> {
  const rows = await tx
    .select({ user: users, role: roles })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .orderBy(asc(users.name), asc(users.id));
  const scopes = await scopesOf(
    tx,
    rows.filter((row) => row.user.departmentScope === "listed").map((row) => row.user.id),
  );
  return rows.map((row) => toView(row.user, row.role, scopes.get(row.user.id) ?? []));
}

async function viewOf(tx: TenantTransaction, userId: string): Promise<UserView> {
  const [row] = await tx
    .select({ user: users, role: roles })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.id, userId));
  if (row === undefined) throw new Error(`user ${userId} vanished`);
  const scopes = await scopesOf(tx, [userId]);
  return toView(row.user, row.role, scopes.get(userId) ?? []);
}

function userNotFound(): ProblemError {
  return new ProblemError(accessProblemCodes.userNotFound, 404, { title: "No such user" });
}

function ownersOnly(): ProblemError {
  return new ProblemError(accessProblemCodes.ownersOnly, 403, {
    title: "Only an owner may manage an owner or the owner role",
  });
}

function useOwnAccount(): ProblemError {
  return new ProblemError(accessProblemCodes.useOwnAccount, 409, {
    title: "Change your own PIN, password, or two-factor authentication from your account",
  });
}

function loginRequired(): ProblemError {
  return new ProblemError(accessProblemCodes.loginRequired, 422, {
    title: "A password needs a login",
  });
}

function loginTaken(error: unknown): unknown {
  if (!violates(error, "users_login_per_tenant")) return error;
  return new ProblemError(accessProblemCodes.loginTaken, 409, {
    title: "Another user of the store has this login",
    cause: error,
  });
}

/** User `id` with their role, locked for the change; 404 when the tenant has none. */
async function lockedUser(
  tx: TenantTransaction,
  id: string,
): Promise<{ readonly user: UserRow; readonly role: RoleRow }> {
  const [user] = await tx.select().from(users).where(eq(users.id, id)).for("update");
  if (user === undefined) throw userNotFound();
  const [role] = await tx.select().from(roles).where(eq(roles.id, user.roleId));
  if (role === undefined) throw new Error(`user ${id} has no role`);
  return { user, role };
}

/** A user who is an owner is managed by owners only (rule 14). */
function checkManages(manager: Manager, target: { readonly role: RoleRow }): void {
  if (target.role.isOwner && !manager.isOwner) throw ownersOnly();
}

/** Refuses a change that leaves no active owner (rule 14); run under `lockTenant`. */
async function checkAnotherOwner(tx: TenantTransaction, userId: string): Promise<void> {
  const owners = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(roles.isOwner, true), eq(users.status, "active")));
  if (owners.every((owner) => owner.id === userId)) {
    throw new ProblemError(accessProblemCodes.lastOwner, 409, {
      title: "The store needs at least one active owner",
    });
  }
}

/**
 * Refuses one more active user beyond the license's `users` limit (rule 4); run under
 * `lockTenant`. Deactivated users do not count, and a lower limit deactivates nobody.
 */
async function checkUserLimit(tx: TenantTransaction): Promise<void> {
  const license = await currentLicense(tx);
  if (license === undefined) throw new Error("the tenant has no license");
  const allowed = license.claims.limits.users;
  const [row] = await tx.select({ active: count() }).from(users).where(eq(users.status, "active"));
  if ((row?.active ?? 0) >= allowed) {
    throw new ProblemError(tenancyProblemCodes.userLimit, 409, {
      title: "The license's user limit is reached",
      detail: `the license allows ${String(allowed)} active users`,
    });
  }
}

/** Every listed department must be an active department of the tenant. */
async function checkDepartments(
  tx: TenantTransaction,
  departments: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(departments)];
  const active = await activeDepartments(tx, unique);
  const missing = unique.filter((id) => !active.has(id));
  if (missing.length > 0) {
    throw new ProblemError(accessProblemCodes.unknownDepartment, 422, {
      title: "A listed department is unknown or archived",
      detail: missing.join(", "),
    });
  }
  return unique;
}

/** An owner's scope is every department (rule 14). */
function checkOwnerScope(role: RoleRow, scope: DepartmentScope): void {
  if (role.isOwner && scope !== "all") {
    throw new ProblemError(accessProblemCodes.roleInvalid, 422, {
      title: "An owner's scope is every department",
    });
  }
}

/** What `addUser` takes: `NewUserRequest` once parsed. */
export interface AddUser {
  readonly name: string;
  readonly login: string | null;
  readonly password: string | null;
  readonly roleId: string;
  readonly departmentScope: DepartmentScope;
  readonly departments: readonly string[];
  readonly pin: string;
}

/**
 * Adds a user (flow 8) with their role, scope, first PIN, and optional login and password,
 * audited `access.user.created`. Refused beyond the license's user limit (409
 * `tenancy.limit.users`), with the owner role unless `manager` is an owner (403
 * `access.user.ownersOnly`), with an archived or unknown role or department, or a login
 * another user has (409 `access.user.loginTaken`). A non-owner gives only a role within what
 * they hold (403 `access.role.beyondOwnGrant`).
 */
export async function addUser(
  tx: TenantTransaction,
  manager: Manager,
  request: AddUser,
  catalogue: PermissionCatalogue,
  dependencies: AccessDependencies,
): Promise<UserView> {
  const passwordHash = request.password === null ? null : await hashPassword(request.password);
  const pinVerifier = await hashPin(request.pin);
  await lockTenant(tx);
  const role = await activeRole(tx, request.roleId);
  if (role.isOwner && !manager.isOwner) throw ownersOnly();
  checkGrantable(manager, await holdingsOf(tx, role, catalogue));
  checkOwnerScope(role, request.departmentScope);
  const listed =
    request.departmentScope === "listed" ? await checkDepartments(tx, request.departments) : [];
  await checkUserLimit(tx);
  const id = dependencies.newId();
  try {
    await createUser(
      tx,
      {
        id,
        tenantId: manager.tenantId,
        branchId: manager.branchId,
        name: request.name,
        login: request.login,
        passwordHash,
        pinVerifier,
        roleId: role.id,
        departmentScope: request.departmentScope === "all" ? "all" : { listed },
        createdAt: manager.at,
        createdBy: manager.userId,
      },
      dependencies,
    );
  } catch (error) {
    throw loginTaken(error);
  }
  const view = await viewOf(tx, id);
  await auditAs(tx, manager, dependencies, {
    action: "access.user.created",
    entity: { type: "access.user", id },
    after: {
      name: view.name,
      login: view.login,
      roleId: role.id,
      departmentScope: view.departmentScope,
      departments: listed,
      status: view.status,
      hasPassword: view.hasPassword,
      hasPin: view.hasPin,
    },
  });
  return view;
}

/** What `changeUser` takes: `UserChangeRequest` once parsed. */
export interface ChangeUser {
  readonly name?: string | undefined;
  readonly login?: string | null | undefined;
  readonly roleId?: string | undefined;
  readonly departmentScope?: DepartmentScope | undefined;
  readonly departments?: readonly string[] | undefined;
}

/**
 * Edits a user (flow 8): name and login, role, and scope, each audited on its own when it
 * changes — `access.user.changed`, `access.user.roleChanged`, `access.user.scopeChanged` —
 * with both sides. Owners are managed by owners only, and so is the owner role, given or taken
 * (rule 14); taking it from the last active owner is refused (409 `access.user.lastOwner`).
 * Moving a user to the owner role gives them every department. A non-owner gives only a role
 * within what they hold (403 `access.role.beyondOwnGrant`) and does not change their own role
 * or scope (403 `access.user.ownAccessChange`).
 */
export async function changeUser(
  tx: TenantTransaction,
  manager: Manager,
  id: string,
  change: ChangeUser,
  catalogue: PermissionCatalogue,
  dependencies: AccessDependencies,
): Promise<UserView> {
  await lockTenant(tx);
  const target = await lockedUser(tx, id);
  checkManages(manager, target);
  const before = await viewOf(tx, id);

  let role = target.role;
  if (change.roleId !== undefined && change.roleId !== target.role.id) {
    role = await activeRole(tx, change.roleId);
    if (role.isOwner && !manager.isOwner) throw ownersOnly();
    checkGrantable(manager, await holdingsOf(tx, role, catalogue));
    if (target.role.isOwner && !role.isOwner && target.user.status === "active") {
      await checkAnotherOwner(tx, id);
    }
  }
  const scope: DepartmentScope =
    change.departmentScope ?? (role.isOwner ? "all" : before.departmentScope);
  checkOwnerScope(role, scope);
  if (scope === "listed" && before.departmentScope !== "listed" && !change.departments?.length) {
    throw new TypeError("a new listed scope names its departments");
  }
  const listed =
    scope === "listed"
      ? change.departments === undefined
        ? [...before.departments]
        : await checkDepartments(tx, change.departments)
      : [];

  const sameDepartments =
    listed.length === before.departments.length &&
    listed.every((department) => before.departments.includes(department));
  const scopeChanged = scope !== before.departmentScope || !sameDepartments;
  if (id === manager.userId && !manager.isOwner && (role.id !== target.role.id || scopeChanged)) {
    throw new ProblemError(accessProblemCodes.ownAccessChange, 403, {
      title: "Another manager changes your role or departments",
    });
  }

  const login = change.login === undefined ? target.user.login : change.login;
  if (login === null && target.user.passwordHash !== null) throw loginRequired();
  const name = change.name ?? target.user.name;
  try {
    await tx
      .update(users)
      .set({ name, login, roleId: role.id, departmentScope: scope })
      .where(eq(users.id, id));
  } catch (error) {
    throw loginTaken(error);
  }
  if (scopeChanged || change.departments !== undefined) {
    await tx.delete(userDepartments).where(eq(userDepartments.userId, id));
    await insertListed(
      tx,
      {
        tenantId: manager.tenantId,
        branchId: manager.branchId,
        createdAt: manager.at,
        createdBy: manager.userId,
      },
      id,
      listed,
      dependencies,
    );
  }
  const after = await viewOf(tx, id);

  const entity = { type: "access.user", id };
  if (after.name !== before.name || after.login !== before.login) {
    await auditAs(tx, manager, dependencies, {
      action: "access.user.changed",
      entity,
      before: { name: before.name, login: before.login },
      after: { name: after.name, login: after.login },
    });
  }
  if (after.role.id !== before.role.id) {
    await auditAs(tx, manager, dependencies, {
      action: "access.user.roleChanged",
      entity,
      before: { roleId: before.role.id, roleName: before.role.name },
      after: { roleId: after.role.id, roleName: after.role.name },
    });
  }
  if (scopeChanged) {
    await auditAs(tx, manager, dependencies, {
      action: "access.user.scopeChanged",
      entity,
      before: { departmentScope: before.departmentScope, departments: before.departments },
      after: { departmentScope: after.departmentScope, departments: after.departments },
    });
  }
  return after;
}

/**
 * Deactivates a user (flow 8) with the reason typed, audited `access.user.deactivated`; their
 * sessions end with it. Refused for the last active owner (409 `access.user.lastOwner`) and for
 * a user already deactivated (409 `access.user.deactivated`).
 */
export async function deactivateUser(
  tx: TenantTransaction,
  manager: Manager,
  id: string,
  reason: string,
  dependencies: AccessDependencies,
): Promise<UserView> {
  await lockTenant(tx);
  const target = await lockedUser(tx, id);
  checkManages(manager, target);
  if (target.user.status !== "active") {
    throw new ProblemError(accessProblemCodes.userDeactivated, 409, {
      title: "The user is already deactivated",
    });
  }
  if (target.role.isOwner) await checkAnotherOwner(tx, id);
  await setStatus(tx, id, "deactivated");
  await auditAs(tx, manager, dependencies, {
    action: "access.user.deactivated",
    entity: { type: "access.user", id },
    before: { status: "active" },
    after: { status: "deactivated" },
    reason,
  });
  await revokeUserSessions(tx, manager, id, dependencies);
  return viewOf(tx, id);
}

/**
 * Reactivates a deactivated user (flow 8), audited `access.user.reactivated`, within the
 * license's user limit. Their role must still be active (409 `access.role.archived`): give
 * them another first.
 */
export async function reactivateUser(
  tx: TenantTransaction,
  manager: Manager,
  id: string,
  dependencies: AccessDependencies,
): Promise<UserView> {
  await lockTenant(tx);
  const target = await lockedUser(tx, id);
  checkManages(manager, target);
  if (target.user.status === "active") {
    throw new ProblemError(accessProblemCodes.userActive, 409, {
      title: "The user is already active",
    });
  }
  await activeRole(tx, target.role.id);
  await checkUserLimit(tx);
  await setStatus(tx, id, "active");
  await auditAs(tx, manager, dependencies, {
    action: "access.user.reactivated",
    entity: { type: "access.user", id },
    before: { status: "deactivated" },
    after: { status: "active" },
  });
  return viewOf(tx, id);
}

/** Ends every open session of `userId`, each audited `access.session.revoked`. */
export async function revokeUserSessions(
  tx: TenantTransaction,
  actor: RoleActor,
  userId: string,
  dependencies: AccessDependencies,
): Promise<void> {
  const revoked = await tx
    .update(sessions)
    .set({ revokedAt: actor.at, revokedBy: actor.userId })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  for (const session of revoked) {
    await auditAs(tx, actor, dependencies, {
      action: "access.session.revoked",
      entity: { type: "access.session", id: session.id },
      after: { userId },
    });
  }
}

async function setStatus(tx: TenantTransaction, id: string, status: UserStatus): Promise<void> {
  await tx.update(users).set({ status }).where(eq(users.id, id));
}

/**
 * Sets or resets another user's PIN (rule 19), audited `access.user.pinSet`. Owners' PINs are
 * set by owners only; one's own goes through `changeOwnPin` (409 `access.user.useOwnAccount`).
 */
export async function setUserPin(
  tx: TenantTransaction,
  manager: Manager,
  id: string,
  pin: string,
  dependencies: AccessDependencies,
): Promise<UserView> {
  if (id === manager.userId) throw useOwnAccount();
  const pinVerifier = await hashPin(pin);
  const target = await lockedUser(tx, id);
  checkManages(manager, target);
  await tx.update(users).set({ pinVerifier, pinChangedAt: manager.at }).where(eq(users.id, id));
  await auditAs(tx, manager, dependencies, {
    action: "access.user.pinSet",
    entity: { type: "access.user", id },
    before: { hasPin: target.user.pinVerifier !== null },
    after: { hasPin: true },
  });
  return viewOf(tx, id);
}

/**
 * Sets or resets another user's password, audited `access.user.passwordSet`; the user's
 * sessions end with it; one's own goes through `changeOwnPassword`. The user needs a login (422
 * `access.user.loginRequired`). Owners' passwords are set by owners only.
 */
export async function setUserPassword(
  tx: TenantTransaction,
  manager: Manager,
  id: string,
  password: string,
  dependencies: AccessDependencies,
): Promise<UserView> {
  if (id === manager.userId) throw useOwnAccount();
  const passwordHash = await hashPassword(password);
  const target = await lockedUser(tx, id);
  checkManages(manager, target);
  if (target.user.login === null) throw loginRequired();
  await tx.update(users).set({ passwordHash }).where(eq(users.id, id));
  await auditAs(tx, manager, dependencies, {
    action: "access.user.passwordSet",
    entity: { type: "access.user", id },
    before: { hasPassword: target.user.passwordHash !== null },
    after: { hasPassword: true },
  });
  await revokeUserSessions(tx, manager, id, dependencies);
  return viewOf(tx, id);
}

/**
 * An owner clears another user's two-factor authentication (rule 26, flow 8) — for a user who
 * lost their phone and their recovery codes — audited `access.twoFactor.cleared` with the reason
 * typed. Owners only
 * (403 `access.user.ownersOnly`); one's own is turned off from one's account (409
 * `access.user.useOwnAccount`); 409 `access.twoFactor.notEnabled` when it is off.
 */
export async function clearUserTwoFactor(
  tx: TenantTransaction,
  manager: Manager,
  id: string,
  reason: string,
  dependencies: AccessDependencies,
): Promise<UserView> {
  if (id === manager.userId) throw useOwnAccount();
  if (!manager.isOwner) {
    throw new ProblemError(accessProblemCodes.ownersOnly, 403, {
      title: "Only an owner clears another user's two-factor authentication",
    });
  }
  await lockedUser(tx, id);
  await clearTwoFactor(tx, manager, id, reason, dependencies);
  return viewOf(tx, id);
}

/** The current secrets offered to prove a change of one's own. */
export interface CurrentSecrets {
  readonly currentPin?: string | undefined;
  readonly currentPassword?: string | undefined;
}

/**
 * Whether `offered` proves the user: with `primary` (the secret being changed) when they have
 * one, otherwise with the other. A missing or wrong secret is a 403
 * `access.user.currentSecretWrong`.
 */
async function prove(
  primary: { readonly hash: string | null; readonly offered: string | undefined },
  fallback: { readonly hash: string | null; readonly offered: string | undefined },
): Promise<void> {
  const proof = primary.hash === null ? fallback : primary;
  const proved =
    proof.hash !== null &&
    proof.offered !== undefined &&
    (await verifyPassword(proof.hash, proof.offered));
  if (!proved) {
    throw new ProblemError(accessProblemCodes.currentSecretWrong, 403, {
      title: "The current PIN or password is wrong",
    });
  }
}

/**
 * The signed-in user changes their own PIN (flow 11), proved with the current PIN, or with
 * their password while they have no PIN (a tenant's first owner); audited
 * `access.user.pinChanged`.
 */
export async function changeOwnPin(
  tx: TenantTransaction,
  actor: RoleActor,
  current: CurrentSecrets,
  pin: string,
  dependencies: AccessDependencies,
): Promise<void> {
  const { user } = await lockedUser(tx, actor.userId);
  await prove(
    { hash: user.pinVerifier, offered: current.currentPin },
    { hash: user.passwordHash, offered: current.currentPassword },
  );
  const pinVerifier = await hashPin(pin);
  await tx.update(users).set({ pinVerifier, pinChangedAt: actor.at }).where(eq(users.id, user.id));
  await auditAs(tx, actor, dependencies, {
    action: "access.user.pinChanged",
    entity: { type: "access.user", id: user.id },
    before: { hasPin: user.pinVerifier !== null },
    after: { hasPin: true },
  });
}

/**
 * The signed-in user changes their own password (flow 11), proved with the current password,
 * or with their PIN while they have none; audited `access.user.passwordChanged`. A user
 * without a login cannot have one (422 `access.user.loginRequired`).
 */
export async function changeOwnPassword(
  tx: TenantTransaction,
  actor: RoleActor,
  current: CurrentSecrets,
  password: string,
  dependencies: AccessDependencies,
): Promise<void> {
  const { user } = await lockedUser(tx, actor.userId);
  if (user.login === null) throw loginRequired();
  await prove(
    { hash: user.passwordHash, offered: current.currentPassword },
    { hash: user.pinVerifier, offered: current.currentPin },
  );
  const passwordHash = await hashPassword(password);
  await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
  await auditAs(tx, actor, dependencies, {
    action: "access.user.passwordChanged",
    entity: { type: "access.user", id: user.id },
    before: { hasPassword: user.passwordHash !== null },
    after: { hasPassword: true },
  });
}
