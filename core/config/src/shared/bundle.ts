import { base64url } from "jose";
import { z } from "zod";

/**
 * The signed configuration bundle (ADR-0021, ADR-0030, `core-foundation` rules 11–12): a JWS
 * manifest naming a SHA-256 for each part, and the parts themselves. The tenant server signs it
 * with the bundle key; devices verify it with the public keys they ship with before using it.
 */

/** The JWS `alg` of every manifest (ADR-0021). */
export const BUNDLE_ALGORITHM = "EdDSA";

/** The JWS `typ` of a manifest, so a license or another token is never taken for one. */
export const BUNDLE_TYPE = "mustawfi-bundle";

/** A signing key id, as a JWS header names it and a key list holds it. */
export const signingKeyIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, "a key id is letters, digits, dots, dashes");

/** Whether `x` is a raw Ed25519 public key in base64url (32 bytes). */
export function isEd25519PublicKey(x: string): boolean {
  try {
    return /^[A-Za-z0-9_-]{43}$/.test(x) && base64url.decode(x).length === 32;
  } catch {
    return false;
  }
}

/** Public keys by key id; each value is a raw Ed25519 public key in base64url. */
export type PublicKeyRing = Readonly<Record<string, string>>;

/**
 * A list of public keys as configuration holds it: `kid:x` pairs separated by commas, `x` the
 * raw Ed25519 public key in base64url (what the key generators print). At least one key; there
 * is never a built-in default. `purpose` names the keys in the refusal (`license`, `bundle`).
 */
export function publicKeyRingSchema(purpose: string) {
  return z.string().transform((value, context): PublicKeyRing => {
    const keys: Record<string, string> = {};
    for (const entry of value.split(",").map((part) => part.trim())) {
      if (entry === "") continue;
      const separator = entry.indexOf(":");
      const kid = entry.slice(0, separator);
      const x = entry.slice(separator + 1);
      if (
        separator < 1 ||
        !signingKeyIdSchema.safeParse(kid).success ||
        !isEd25519PublicKey(x) ||
        Object.hasOwn(keys, kid)
      ) {
        context.addIssue({ code: "custom", message: `"${entry}" is not a unique kid:key pair` });
        return z.NEVER;
      }
      keys[kid] = x;
    }
    if (Object.keys(keys).length === 0) {
      context.addIssue({ code: "custom", message: `no ${purpose} public key is configured` });
      return z.NEVER;
    }
    return keys;
  });
}

/** A part's name: `license`, `access`, `organization`… one word in camelCase. */
export const bundlePartNameSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]{0,39}$/, "a part name is one camelCase word");

/** The SHA-256 of a part's text (its UTF-8 bytes), in base64url. */
export const partDigestSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "not a SHA-256");

/** An instant on the wire: ISO 8601 in UTC with milliseconds. */
const instantSchema = z.iso
  .datetime({ precision: 3 })
  .refine((value) => new Date(value).toISOString() === value, "an instant is written in UTC");

/** What the manifest signs. */
export const bundleManifestSchema = z.strictObject({
  /** Increases whenever a part of this device's bundle changes (rule 12). */
  version: z.int().min(1),
  issuedAt: instantSchema,
  /** The one device this bundle is for; any other refuses it (rule 11). */
  deviceId: z.uuid(),
  /** The installed license the `license` part carries. */
  licenseRef: z.uuid(),
  parts: z.record(bundlePartNameSchema, partDigestSchema),
});

export type BundleManifest = z.infer<typeof bundleManifestSchema>;

/** A bundle as it travels: the manifest JWS and each part's JSON text, hashed as sent. */
export const signedBundleSchema = z.object({
  manifest: z.string().min(1).max(8192),
  parts: z.record(bundlePartNameSchema, z.string().max(4_000_000)),
});

export type SignedBundle = z.infer<typeof signedBundleSchema>;

/** `GET /api/v1/sync/bundle`: the version the device holds, 0 for none. */
export const bundleQuerySchema = z.object({
  version: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
});

/** The current version, and the bundle itself unless the device already holds that version. */
export const bundleResponseSchema = z.object({
  version: z.int().min(1),
  bundle: signedBundleSchema.nullable(),
});

export type BundleResponse = z.infer<typeof bundleResponseSchema>;
