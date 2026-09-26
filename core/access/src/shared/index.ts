import {
  limitIdSchema,
  limitValueSchema,
  type PermissionCatalogue,
  permissionIdSchema,
  ROLE_TEMPLATES,
} from "@mustawfi/core-config/shared";
import { z } from "zod";
import { pinSchema } from "./pin.ts";

export {
  accessGrant,
  type AccessGrant,
  type LimitValue,
  type RoleAccess,
  type RoleHoldings,
  roleHoldings,
  type StoredRole,
  templateGrants,
} from "./grant.ts";
export { isPinAllowed, pinSchema } from "./pin.ts";

/** A user's login name: lower case after trimming, letters, digits, `.`, `_`, `-`. */
export const loginSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,64}$/, "a login is 3–64 letters, digits, dots, dashes, or underscores");

/** Length only: no composition rules, and a ceiling so hashing stays bounded. */
export const passwordSchema = z.string().min(10).max(256);

export const userNameSchema = z.string().trim().min(1).max(200);

export const roleNameSchema = z.string().trim().min(1).max(100);

/** A device's role (ADR-0022): the main POS, or a mobile companion. */
export const deviceTypeSchema = z.enum(["mainPos", "companion"]);
export type DeviceType = z.infer<typeof deviceTypeSchema>;

export const deviceNameSchema = z.string().trim().min(1).max(100);

/**
 * `POST /api/v1/access/login`. Only lengths are checked here: whatever else is wrong, the
 * answer is the same `access.login.failed`.
 */
export const loginRequestSchema = z.object({
  storeCode: z.string().max(20),
  login: z.string().max(100),
  password: z.string().max(256),
  /**
   * A code from the user's authenticator app, or one of their recovery codes, when they have
   * two-factor authentication (`core-foundation` rule 26). Without it, a correct password of
   * such a user is answered 401 `access.login.secondFactorRequired`.
   */
  secondFactor: z.string().max(40).optional(),
  /**
   * How the session travels (ADR-0022): `bearer` returns the token for the desktop and
   * Android shells' secure store; `cookie` (the browser) sets an `HttpOnly` cookie instead and
   * never shows the token to scripts.
   */
  transport: z.enum(["bearer", "cookie"]).default("bearer"),
});

/**
 * `POST /api/v1/access/pin-login`: online PIN sign-in on a registered device (rule 21), with
 * the device credential in the `Mustawfi-Device` header. The user is picked from the name
 * tiles, so the request names them by id.
 */
export const pinLoginRequestSchema = z.object({
  userId: z.uuid(),
  pin: z.string().max(6),
  transport: z.enum(["bearer", "cookie"]).default("bearer"),
});

/**
 * `POST /api/v1/access/password-reset` (rule 27): an owner sets a new password — and a new
 * PIN, when asked — with the one-time code Vertex support issued them.
 */
export const passwordResetRequestSchema = z.object({
  storeCode: z.string().max(20),
  login: z.string().max(100),
  code: z.string().max(20),
  password: passwordSchema,
  pin: pinSchema.optional(),
});

/**
 * A TOTP code as typed (six digits; spaces forgiven), or `undefined` when `typed` is not one —
 * then it may be a recovery code.
 */
export function totpCodeOf(typed: string): string | undefined {
  const code = typed.replace(/\s/g, "");
  return /^\d{6}$/.test(code) ? code : undefined;
}

/** How many recovery codes a user receives when they enable two-factor authentication. */
export const RECOVERY_CODE_COUNT = 10;

/** `GET /api/v1/access/me`: the signed-in user's own account, for «My account» (flow 11). */
export const accountViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  login: z.string().nullable(),
  hasPassword: z.boolean(),
  hasPin: z.boolean(),
  twoFactor: z.object({
    enabled: z.boolean(),
    enabledAt: z.iso.datetime().nullable(),
    /** Recovery codes not used yet. */
    recoveryCodesLeft: z.int().min(0),
  }),
});

export type AccountView = z.infer<typeof accountViewSchema>;

/**
 * `POST /api/v1/access/me/two-factor/enrolment`: starts setting up two-factor authentication,
 * proved with the current password. Only users with a password have it (rule 26).
 */
export const startTwoFactorRequestSchema = z.object({
  currentPassword: z.string().max(256),
});

/** The new secret, shown once: as a QR code of `uri` and as text to type into the app. */
export const twoFactorEnrolmentSchema = z.object({
  /** Base32, as authenticator apps take it by hand. */
  secret: z.string(),
  /** `otpauth://totp/…`, for the QR code. */
  uri: z.string(),
});

export type TwoFactorEnrolment = z.infer<typeof twoFactorEnrolmentSchema>;

/** `POST /api/v1/access/me/two-factor/confirm`: the first code from the app turns it on. */
export const confirmTwoFactorRequestSchema = z.object({ code: z.string().max(40) });

/** The recovery codes, shown once when two-factor authentication is turned on. */
export const recoveryCodesSchema = z.object({
  recoveryCodes: z.array(z.string()).length(RECOVERY_CODE_COUNT),
});

/**
 * `POST /api/v1/access/me/two-factor/disable`: turns it off, proved with the current password
 * and a code from the app or a recovery code.
 */
export const disableTwoFactorRequestSchema = z.object({
  currentPassword: z.string().max(256),
  code: z.string().max(40),
});

/** A user's department scope: every department, or the listed ones. */
export const departmentScopeSchema = z.enum(["all", "listed"]);
export type DepartmentScope = z.infer<typeof departmentScopeSchema>;

/** The signed-in user with their role, scope, and effective permissions (`core-foundation` slice 5). */
export const sessionUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  login: z.string().nullable(),
  role: z.object({ id: z.uuid(), name: z.string(), isOwner: z.boolean() }),
  departmentScope: departmentScopeSchema,
  /** The active departments of a `listed` scope; empty for `all`. */
  departments: z.array(z.uuid()),
  /**
   * Every declared permission the user holds; a scoped one holds only in the scope's
   * departments (rule 15).
   */
  permissions: z.array(z.string()),
});

export const loginResponseSchema = z.object({
  /** Opaque; sent back as `Authorization: Bearer <token>`. Absent for the cookie transport. */
  token: z.string().optional(),
  expiresAt: z.iso.datetime(),
  tenantId: z.uuid(),
  user: sessionUserSchema,
});

export const currentSessionSchema = z.object({
  tenantId: z.uuid(),
  expiresAt: z.iso.datetime(),
  user: sessionUserSchema,
});

/** A user's status: users are deactivated, never deleted. */
export const userStatusSchema = z.enum(["active", "deactivated"]);
export type UserStatus = z.infer<typeof userStatusSchema>;

const departmentIdsSchema = z.array(z.uuid()).max(100);

/** A listed scope names at least one department; `all` names none. */
function checkScope(
  value: {
    readonly departmentScope?: DepartmentScope | undefined;
    readonly departments?: readonly string[] | undefined;
  },
  context: z.RefinementCtx,
): void {
  if (value.departmentScope === undefined) {
    if (value.departments !== undefined) {
      context.addIssue({ code: "custom", message: "departments come with a departmentScope" });
    }
    return;
  }
  const count = value.departments?.length ?? 0;
  if (value.departmentScope === "listed" && count === 0) {
    context.addIssue({ code: "custom", message: "a listed scope names at least one department" });
  }
  if (value.departmentScope === "all" && count > 0) {
    context.addIssue({ code: "custom", message: "the scope of every department lists none" });
  }
}

/**
 * `POST /api/v1/access/users` (flow 8): a login and a password are optional, the first PIN is
 * not (rule 19). A password needs a login to sign in with.
 */
export const newUserRequestSchema = z
  .object({
    name: userNameSchema,
    login: loginSchema.nullable().default(null),
    password: passwordSchema.nullable().default(null),
    roleId: z.uuid(),
    departmentScope: departmentScopeSchema,
    departments: departmentIdsSchema.default([]),
    pin: pinSchema,
  })
  .superRefine((value, context) => {
    checkScope(value, context);
    if (value.password !== null && value.login === null) {
      context.addIssue({ code: "custom", message: "a password needs a login", path: ["login"] });
    }
  });

export type NewUserRequest = z.input<typeof newUserRequestSchema>;

/**
 * `PATCH /api/v1/access/users/:id`: what changes, the rest stays. `departments` comes with
 * `departmentScope`; a `null` login removes it (refused while the user has a password).
 */
export const userChangeRequestSchema = z
  .object({
    name: userNameSchema.optional(),
    login: loginSchema.nullable().optional(),
    roleId: z.uuid().optional(),
    departmentScope: departmentScopeSchema.optional(),
    departments: departmentIdsSchema.optional(),
  })
  .superRefine(checkScope);

export type UserChangeRequest = z.input<typeof userChangeRequestSchema>;

/** Why a user is deactivated or a device revoked: kept in the audit log. */
export const reasonSchema = z.string().trim().min(1).max(500);

/** `POST /api/v1/access/users/:id/deactivate`: the reason is kept in the audit log. */
export const deactivateUserRequestSchema = z.object({ reason: reasonSchema });

/**
 * `POST /api/v1/access/users/:id/two-factor/clear`: an owner clears another user's two-factor
 * authentication (rule 26); the reason is kept in the audit log.
 */
export const clearTwoFactorRequestSchema = z.object({ reason: reasonSchema });

/** `PUT /api/v1/access/users/:id/pin`: a manager sets or resets someone's PIN. */
export const setPinRequestSchema = z.object({ pin: pinSchema });

/** `PUT /api/v1/access/users/:id/password`: a manager sets or resets someone's password. */
export const setPasswordRequestSchema = z.object({ password: passwordSchema });

/**
 * `PUT /api/v1/access/me/pin`: the user's own PIN, proved with the current PIN — or, while
 * they have none (a tenant's first owner), with their password.
 */
export const changeOwnPinRequestSchema = z.object({
  currentPin: z.string().max(6).optional(),
  currentPassword: z.string().max(256).optional(),
  pin: pinSchema,
});

/**
 * `PUT /api/v1/access/me/password`: the user's own password, proved with the current
 * password — or, while they have none, with their PIN.
 */
export const changeOwnPasswordRequestSchema = z.object({
  currentPassword: z.string().max(256).optional(),
  currentPin: z.string().max(6).optional(),
  password: passwordSchema,
});

/** A user as the users screen shows them; secrets are never sent, only whether they are set. */
export const userViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  login: z.string().nullable(),
  role: z.object({ id: z.uuid(), name: z.string(), isOwner: z.boolean() }),
  departmentScope: departmentScopeSchema,
  /** The active departments of a `listed` scope; empty for `all`. */
  departments: z.array(z.uuid()),
  status: userStatusSchema,
  hasPassword: z.boolean(),
  hasPin: z.boolean(),
  /** Whether they sign in with a second factor (rule 26); an owner may clear it. */
  twoFactorEnabled: z.boolean(),
  createdAt: z.iso.datetime(),
});

export type UserView = z.infer<typeof userViewSchema>;

/**
 * `POST /api/v1/access/roles` (a copy the editor starts from another role) and
 * `PUT /api/v1/access/roles/:id`: the whole role but its template.
 */
export const roleRequestSchema = z.object({
  name: roleNameSchema,
  permissions: z.array(permissionIdSchema).max(1000),
  /** Limit values by limit id; a limit left out is zero for the role (rule 16). */
  limits: z.record(limitIdSchema, limitValueSchema).default({}),
});

export type RoleRequest = z.input<typeof roleRequestSchema>;

/** A role as the roles screen shows it. */
export const roleViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** `owner`, the template it was seeded from, or null for a copy. */
  template: z.enum(["owner", ...ROLE_TEMPLATES]).nullable(),
  isOwner: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  /** What the role holds; the owner role holds every declared permission. */
  permissions: z.array(z.string()),
  /** Limit values by limit id; the owner role has none because it is unlimited. */
  limits: z.record(z.string(), z.string()),
  activeUsers: z.int().min(0),
});

export type RoleView = z.infer<typeof roleViewSchema>;

/** `GET /api/v1/access/catalogue`: what a role can hold, for the permission matrix. */
export const permissionCatalogueSchema = z.object({
  permissions: z.array(z.object({ id: z.string(), moduleId: z.string(), scoped: z.boolean() })),
  limits: z.array(
    z.object({
      id: z.string(),
      moduleId: z.string(),
      kind: z.enum(["percent", "amount", "count"]),
    }),
  ),
});

export type PermissionCatalogueView = z.infer<typeof permissionCatalogueSchema>;

export const registrationCodeResponseSchema = z.object({
  /** Typed on the new device together with the store code; single use. */
  code: z.string(),
  storeCode: z.string(),
  expiresAt: z.iso.datetime(),
});

export const registerDeviceRequestSchema = z.object({
  storeCode: z.string().max(20),
  registrationCode: z.string().max(20),
  type: deviceTypeSchema,
  name: deviceNameSchema,
});

export const registeredDeviceSchema = z.object({
  deviceId: z.uuid(),
  tenantId: z.uuid(),
  /** As registered. */
  name: z.string(),
  /** The device's document-number prefix (ADR-0020). */
  prefix: z.string(),
  /** Shown once: the device keeps it in the OS secure store and syncs with it. */
  credential: z.string(),
  /** The store's base currency, which the device sells in until multi-currency sales exist. */
  baseCurrency: z.string(),
});

export const currentDeviceSchema = z.object({
  deviceId: z.uuid(),
  tenantId: z.uuid(),
  prefix: z.string(),
  type: deviceTypeSchema,
  name: z.string(),
});

/** `POST /api/v1/access/devices/:id/revoke`: the reason is kept in the audit log. */
export const revokeDeviceRequestSchema = z.object({ reason: reasonSchema });

/** A device as the devices screen shows it; its credential is never sent. */
export const deviceViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: deviceTypeSchema,
  prefix: z.string(),
  registeredAt: z.iso.datetime(),
  /** The server's time of its last push or pull; null before its first. */
  lastSyncAt: z.iso.datetime().nullable(),
  status: z.enum(["active", "revoked"]),
  revokedAt: z.iso.datetime().nullable(),
  revokedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  revokeReason: z.string().nullable(),
  /** When the revoked device reported its wipe; null until then, or if it never could. */
  wipedAt: z.iso.datetime().nullable(),
});

export type DeviceView = z.infer<typeof deviceViewSchema>;

/** The refusals `core.access` answers with; clients map each code to an Arabic message. */
export const accessProblemCodes = {
  /** Unknown store, unknown login, or wrong password — never which one. */
  loginFailed: "access.login.failed",
  /**
   * Too many failed sign-ins for this login, this user on this device, or from this address
   * (429, rule 21); the detail says until when.
   */
  loginThrottled: "access.login.throttled",
  /**
   * The password is right and the user has two-factor authentication: sign in again with a code
   * from the app or a recovery code (401, rule 26).
   */
  secondFactorRequired: "access.login.secondFactorRequired",
  /** The code from the app or the recovery code is wrong, already used, or expired (401). */
  secondFactorInvalid: "access.login.secondFactorInvalid",
  /** Two-factor authentication needs a password: the user has none (409). */
  twoFactorPasswordRequired: "access.twoFactor.passwordRequired",
  /** Two-factor authentication is already on: turn it off first (409). */
  twoFactorAlreadyEnabled: "access.twoFactor.alreadyEnabled",
  /** Confirmation without a started enrolment (409). */
  twoFactorNotStarted: "access.twoFactor.notStarted",
  /** Two-factor authentication is off (409). */
  twoFactorNotEnabled: "access.twoFactor.notEnabled",
  /** The code from the app or the recovery code is wrong or already used (422). */
  twoFactorCodeInvalid: "access.twoFactor.codeInvalid",
  /** Unknown store or login, not an owner, or a reset code that is unknown, used, or expired. */
  resetCodeInvalid: "access.resetCode.invalid",
  /** No session, or a malformed, unknown, expired, or revoked one. */
  sessionRequired: "access.session.required",
  /** The user's role lacks the permission the action needs (`core-foundation` rule 17). */
  permissionDenied: "access.permission.denied",
  /** A role naming a permission or limit no module declares, or a malformed limit value. */
  roleInvalid: "access.role.invalid",
  /** Unknown store, or a registration code that is unknown, used, or expired. */
  registrationFailed: "access.registration.failed",
  /** Every device prefix of the tenant is taken. */
  prefixesExhausted: "access.device.prefixesExhausted",
  /**
   * No device credential, or an unknown one: on sync, on PIN sign-in, and on a password
   * sign-in that sends one.
   */
  deviceRequired: "access.device.required",
  /**
   * The device credential is a revoked device's (401, rule 23): refused everywhere but push and
   * the wipe report. The device learns it was removed from the store.
   */
  deviceRevoked: "access.device.revoked",
  /** No device with this id in the tenant. */
  deviceNotFound: "access.device.notFound",
  /** The device is already revoked. */
  deviceAlreadyRevoked: "access.device.alreadyRevoked",
  /** A wipe reported by a device that is not revoked. */
  deviceNotRevoked: "access.device.notRevoked",
  /** A cookie-authenticated change sent from another origin (CSRF, ADR-0022). */
  crossOrigin: "access.request.crossOrigin",
  /** No user with this id in the tenant. */
  userNotFound: "access.user.notFound",
  /** Another user of the tenant has this login. */
  loginTaken: "access.user.loginTaken",
  /** A password needs a login: the user has, or would have, a password and no login. */
  loginRequired: "access.user.loginRequired",
  /** A listed department is unknown or archived. */
  unknownDepartment: "access.user.unknownDepartment",
  /** Managing an owner, or granting or removing the owner role, takes an owner (rule 14). */
  ownersOnly: "access.user.ownersOnly",
  /** The change would leave the tenant with no active owner (rule 14). */
  lastOwner: "access.user.lastOwner",
  /** The user is already deactivated. */
  userDeactivated: "access.user.deactivated",
  /** The user is already active. */
  userActive: "access.user.active",
  /** The current PIN or password given to prove a change of one's own is wrong. */
  currentSecretWrong: "access.user.currentSecretWrong",
  /** No role with this id in the tenant. */
  roleNotFound: "access.role.notFound",
  /** Another active role has this name. */
  roleNameTaken: "access.role.nameTaken",
  /** The role is archived: it cannot be edited, archived again, or given to a user. */
  roleArchived: "access.role.archived",
  /** The owner role cannot be edited or archived (rule 14). */
  ownerRoleFixed: "access.role.ownerFixed",
  /** Active users hold the role; give them another before archiving it. */
  roleInUse: "access.role.inUse",
  /** A non-owner granting a permission or limit value beyond their own (slice 6 decision). */
  beyondOwnGrant: "access.role.beyondOwnGrant",
  /** A non-owner changing their own role or department scope (slice 6 decision). */
  ownAccessChange: "access.user.ownAccessChange",
  /** One's own PIN or password is changed from one's account, proved by the current one. */
  useOwnAccount: "access.user.useOwnAccount",
} as const;

/** A permission catalogue as the API and the bundle carry it: ids, modules, scope, kinds. */
export function catalogueView(catalogue: PermissionCatalogue): PermissionCatalogueView {
  return {
    permissions: [...catalogue.permissions.values()].map((p) => ({
      id: p.id,
      moduleId: p.moduleId,
      scoped: p.scoped,
    })),
    limits: [...catalogue.limits.values()].map((l) => ({
      id: l.id,
      moduleId: l.moduleId,
      kind: l.kind,
    })),
  };
}

/** The name of the configuration bundle's part that carries access (ADR-0030). */
export const ACCESS_BUNDLE_PART = "access";

/**
 * The bundle's `access` part (ADR-0030): what a device needs to sign users in and check what
 * they may do without the server — the declared catalogue (the client resolves grants against
 * it, slice 16), the roles of the users allowed on the device, and those users with their PIN
 * verifiers. Every active user of the tenant is allowed on every device in V1.
 */
export const accessPartSchema = z.strictObject({
  catalogue: permissionCatalogueSchema,
  roles: z.array(
    z.strictObject({
      id: z.uuid(),
      name: z.string(),
      /** Every permission, no department restriction, no limit (rule 14). */
      isOwner: z.boolean(),
      /** Sorted; every declared permission for the owner role. */
      permissions: z.array(permissionIdSchema),
      /** Limit values by limit id; none for the owner role. */
      limits: z.record(z.string(), limitValueSchema),
    }),
  ),
  users: z.array(
    z.strictObject({
      id: z.uuid(),
      name: z.string(),
      roleId: z.uuid(),
      departmentScope: departmentScopeSchema,
      /** The active departments of a `listed` scope; empty for `all`. */
      departments: z.array(z.uuid()),
      /** The Argon2id PHC string of the user's PIN; null while they have none. */
      pinVerifier: z.string().startsWith("$argon2id$").nullable(),
      pinChangedAt: z.iso.datetime().nullable(),
    }),
  ),
});

export type AccessPart = z.infer<typeof accessPartSchema>;
