import { z } from "zod";

/** A user's login name: lower case after trimming, letters, digits, `.`, `_`, `-`. */
export const loginSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,64}$/, "a login is 3–64 letters, digits, dots, dashes, or underscores");

/** Length only: no composition rules, and a ceiling so hashing stays bounded. */
export const passwordSchema = z.string().min(10).max(256);

export const userNameSchema = z.string().trim().min(1).max(200);

export const newOwnerSchema = z.object({
  name: userNameSchema,
  login: loginSchema,
});

export type NewOwnerInput = z.input<typeof newOwnerSchema>;

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

export const sessionUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  login: z.string(),
  isOwner: z.boolean(),
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
  /** No session, or a malformed, unknown, expired, or revoked one. */
  sessionRequired: "access.session.required",
  /** The action needs the tenant's owner. */
  ownerRequired: "access.permission.ownerRequired",
  /** Unknown store, or a registration code that is unknown, used, or expired. */
  registrationFailed: "access.registration.failed",
  /** Every device prefix of the tenant is taken. */
  prefixesExhausted: "access.device.prefixesExhausted",
  /** No device credential, or an unknown one. */
  deviceRequired: "access.device.required",
  /** A cookie-authenticated change sent from another origin (CSRF, ADR-0022). */
  crossOrigin: "access.request.crossOrigin",
} as const;
