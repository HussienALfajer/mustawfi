import {
  limitIdSchema,
  limitValueSchema,
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

/** `POST /api/v1/access/users/:id/deactivate`: the reason is kept in the audit log. */
export const deactivateUserRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

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

/** The refusals `core.access` answers with; clients map each code to an Arabic message. */
export const accessProblemCodes = {
  /** Unknown store, unknown login, or wrong password — never which one. */
  loginFailed: "access.login.failed",
  /**
   * Too many failed sign-ins for this login, this user on this device, or from this address
   * (429, rule 21); the detail says until when.
   */
  loginThrottled: "access.login.throttled",
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
