import { lastChangeSchema } from "@mustawfi/core-audit/shared";
import {
  departmentNameSchema,
  departmentSchema,
  LICENSE_STATES,
  tenantNameSchema,
} from "@mustawfi/core-tenancy/shared";
import { phoneNumberSchema } from "@mustawfi/kernel";
import { z } from "zod";

export { type DocumentNumber, formatDocumentNumber, parseDocumentNumber } from "./numbering.ts";

export {
  departmentNameSchema,
  departmentSchema,
  type DepartmentView,
} from "@mustawfi/core-tenancy/shared";

/** Departments flow down to every device (ADR-0020); a change carries the full `DepartmentView`. */
export const DEPARTMENT_ENTITY = "organization.department";

/** The store profile flows down to every device; a change carries the full `StoreProfileView`. */
export const STORE_PROFILE_ENTITY = "organization.storeProfile";

/** A logo is a PNG or JPEG of at most 256 KB (`core-foundation`, `store_profiles`). */
export const LOGO_MAX_BYTES = 256 * 1024;

export const LOGO_TYPES = ["image/png", "image/jpeg"] as const;

export type LogoType = (typeof LOGO_TYPES)[number];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

const startsWith = (bytes: Uint8Array, signature: readonly number[]) =>
  bytes.length > signature.length && signature.every((byte, i) => bytes[i] === byte);

/** The image type of `bytes` from their signature, whatever the upload claims. */
export function logoTypeOf(bytes: Uint8Array): LogoType | undefined {
  if (startsWith(bytes, PNG_SIGNATURE)) return "image/png";
  if (startsWith(bytes, JPEG_SIGNATURE)) return "image/jpeg";
  return undefined;
}

/** The store's phones: up to three, stored in E.164 (`core-foundation` slice 21). */
export const STORE_PHONES_MAX = 3;

/**
 * How the receipt prints the logo (`core-foundation` slice 21): `threshold` — «شعار خطّي»,
 * each dot black or white by its brightness, sharp for a drawn logo; `dither` — «صورة»,
 * error diffusion, which keeps the greys of a photo as patterns of dots.
 */
export const LOGO_PRINT_MODES = ["threshold", "dither"] as const;

export type LogoPrintMode = (typeof LOGO_PRINT_MODES)[number];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined || value === null || value === "" ? null : value));

/** `PUT /api/v1/organization/profile`: the whole profile but the logo. */
export const storeProfileInputSchema = z.object({
  name: tenantNameSchema,
  address: optionalText(500),
  // One number written twice (`0944…` and `+963944…`) would print twice (QA slice 22).
  phones: z
    .array(phoneNumberSchema)
    .max(STORE_PHONES_MAX)
    .refine((phones) => new Set(phones).size === phones.length, "a phone is listed twice")
    .default([]),
  taxNumber: optionalText(50),
  commercialRegister: optionalText(50),
  logoPrint: z.enum(LOGO_PRINT_MODES).default("threshold"),
});

export type StoreProfileInput = z.input<typeof storeProfileInputSchema>;

/** What a device knows of the logo; the image itself is fetched by its hash. */
export const logoInfoSchema = z.object({
  type: z.enum(LOGO_TYPES),
  /** Lower-case hex SHA-256 of the image bytes. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.int().min(1).max(LOGO_MAX_BYTES),
});

export type LogoInfo = z.infer<typeof logoInfoSchema>;

export const storeProfileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  address: z.string().nullable(),
  /** E.164 (`core-foundation` slice 21). */
  phones: z.array(z.string()).max(STORE_PHONES_MAX),
  /**
   * Phones written before slice 21 that could not be read as a number, as typed: the store
   * profile screen shows them flagged, and the next save replaces them. Receipts leave them out.
   */
  unreadablePhones: z.array(z.string()).max(STORE_PHONES_MAX).default([]),
  taxNumber: z.string().nullable(),
  commercialRegister: z.string().nullable(),
  logo: logoInfoSchema.nullable(),
  logoPrint: z.enum(LOGO_PRINT_MODES),
  updatedAt: z.iso.datetime(),
});

export type StoreProfileView = z.infer<typeof storeProfileSchema>;

/** `PUT /api/v1/organization/profile/logo`: the image, base64-encoded. */
export const logoUploadSchema = z.object({
  /** Its decoded size is checked against `LOGO_MAX_BYTES` (422 `organization.logo.tooLarge`). */
  data: z.base64().min(1),
});

/** `POST /api/v1/organization/departments`. */
export const newDepartmentSchema = z.object({
  name: departmentNameSchema,
});

/** `PATCH /api/v1/organization/departments/:id`. */
export const departmentRenameSchema = z.object({
  name: departmentNameSchema,
});

/**
 * A department as the departments screen lists it: its last change from the audit log (the
 * panel's «last changed by … on …»), which devices and the bundle do not carry.
 */
export const departmentListItemSchema = departmentSchema.extend({
  lastChange: lastChangeSchema.nullable(),
});

export type DepartmentListItem = z.infer<typeof departmentListItemSchema>;

/** The refusals of `core.organization`; clients map each code to an Arabic message. */
export const organizationProblemCodes = {
  /** The logo is larger than `LOGO_MAX_BYTES`. */
  logoTooLarge: "organization.logo.tooLarge",
  /** The logo is neither a PNG nor a JPEG. */
  logoUnsupportedType: "organization.logo.unsupportedType",
  /** The store has no logo to fetch. */
  logoNotFound: "organization.logo.notFound",
} as const;

/** The name of the configuration bundle's part that carries the organization (ADR-0030). */
export const ORGANIZATION_BUNDLE_PART = "organization";

/**
 * The bundle's `organization` part: every department, archived ones included (documents keep
 * naming them), and the store profile without the logo's bytes — the logo is fetched on its own
 * and checked against the hash the profile carries.
 */
export const organizationPartSchema = z.strictObject({
  departments: z.array(departmentSchema),
  profile: storeProfileSchema,
});

export type OrganizationPart = z.infer<typeof organizationPartSchema>;

/** The license's limits, in the order the «License and plan» screen lists them (rule 4). */
export const LICENSE_LIMITS = [
  "users",
  "departments",
  "mainPosDevices",
  "companionDevices",
] as const;

export type LicenseLimitName = (typeof LICENSE_LIMITS)[number];

/**
 * `GET /api/v1/organization/license`: the owners' «License and plan» summary — the plan, the
 * lifecycle state by the server's clock, when each later state begins, and each limit as used
 * of allowed. Used can exceed allowed after a downgrade, which deactivates nothing (rule 4).
 */
export const licenseSummarySchema = z.object({
  plan: z.string(),
  state: z.enum(LICENSE_STATES),
  expiresAt: z.iso.datetime(),
  /** When writes stop: the grace days are over. */
  readOnlyAt: z.iso.datetime(),
  /** When only owners are admitted: the read-only days are over too. */
  suspendedAt: z.iso.datetime(),
  limits: z.array(
    z.object({
      limit: z.enum(LICENSE_LIMITS),
      used: z.int().min(0),
      allowed: z.int().min(0),
    }),
  ),
});

export type LicenseSummary = z.infer<typeof licenseSummarySchema>;
