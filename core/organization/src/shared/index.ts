import { departmentNameSchema, tenantNameSchema } from "@mustawfi/core-tenancy/shared";
import { z } from "zod";

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

/** Up to three phone numbers as people write them: digits, `+`, spaces, and dashes. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 -]{2,23}$/, "a phone number is digits, with an optional + and dashes");

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
  phones: z.array(phoneSchema).max(3).default([]),
  taxNumber: optionalText(50),
  commercialRegister: optionalText(50),
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
  phones: z.array(z.string()).max(3),
  taxNumber: z.string().nullable(),
  commercialRegister: z.string().nullable(),
  logo: logoInfoSchema.nullable(),
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

/** The refusals of `core.organization`; clients map each code to an Arabic message. */
export const organizationProblemCodes = {
  /** The logo is larger than `LOGO_MAX_BYTES`. */
  logoTooLarge: "organization.logo.tooLarge",
  /** The logo is neither a PNG nor a JPEG. */
  logoUnsupportedType: "organization.logo.unsupportedType",
  /** The store has no logo to fetch. */
  logoNotFound: "organization.logo.notFound",
} as const;
