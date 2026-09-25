import { base64url, errors, importJWK, jwtVerify } from "jose";
import { z } from "zod";

/**
 * Tenant licenses (ADR-0008, ADR-0021, ADR-0030): one per tenant, an Ed25519 JWS issued by
 * Vertex staff with the license key. The tenant server and devices hold only public keys.
 */

/** The JWS `alg` of every license (ADR-0021). */
export const LICENSE_ALGORITHM = "EdDSA";

/** The JWS `typ` of a license, so a bundle or another token signed by mistake is refused. */
export const LICENSE_TYPE = "mustawfi-license";

const MS_PER_DAY = 86_400_000;

/** Days before `expiresAt` from which owners are warned (ADR-0008: reminders at 14 days). */
export const EXPIRING_DAYS = 14;

/** A key id: what the JWS header names and `LICENSE_PUBLIC_KEYS` lists. */
export const licenseKeyIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, "a key id is letters, digits, dots, dashes");

/** An instant on the wire: ISO 8601 in UTC with milliseconds, as `Date#toISOString` writes it. */
const instantSchema = z.iso
  .datetime({ precision: 3 })
  .refine((value) => new Date(value).toISOString() === value, "an instant is written in UTC");

const daysSchema = z.number().int().min(0).max(3650);
const countSchema = z.number().int().min(0).max(10_000);

/** The four limits this unit enforces (`core-foundation` rule 4). */
export const licenseLimitsSchema = z.strictObject({
  users: countSchema.min(1),
  departments: countSchema.min(1),
  mainPosDevices: countSchema,
  companionDevices: countSchema,
});

export type LicenseLimits = z.infer<typeof licenseLimitsSchema>;

/** A module id (`core.tenancy`, `serials`), as entitlements list them. */
const moduleIdSchema = z.string().regex(/^[a-z][a-zA-Z0-9-]*(\.[a-z][a-zA-Z0-9-]*)?$/);

/** The license claims (ADR-0030). No device claim: a device is bound by its credential. */
export const licenseClaimsSchema = z
  .strictObject({
    tenant: z.uuid(),
    /** The plan's code (`basic`, `phonesPro`); the claims carry its resolved values. */
    plan: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
    /** The issuer's time; a license replaces the installed one only when issued later. */
    issuedAt: instantSchema,
    notBefore: instantSchema,
    expiresAt: instantSchema,
    graceDays: daysSchema,
    readOnlyDays: daysSchema,
    maxOfflineDays: daysSchema.min(1),
    limits: licenseLimitsSchema,
    /** The modules the tenant may use; `core-config` enforces them. */
    entitlements: z.array(moduleIdSchema),
  })
  .refine((claims) => claims.expiresAt > claims.notBefore, {
    message: "a license expires after it becomes valid",
    path: ["expiresAt"],
  });

export type LicenseClaims = z.infer<typeof licenseClaimsSchema>;

/**
 * The public license keys by key id: `kid:x` pairs separated by commas, `x` being the raw
 * Ed25519 public key in base64url (what `license:keygen` prints). There is no built-in
 * default: a server without configured keys installs nothing.
 */
export const licensePublicKeysSchema = z.string().transform((value, context) => {
  const keys: Record<string, string> = {};
  for (const entry of value.split(",").map((part) => part.trim())) {
    if (entry === "") continue;
    const separator = entry.indexOf(":");
    const kid = entry.slice(0, separator);
    const x = entry.slice(separator + 1);
    if (
      separator < 1 ||
      !licenseKeyIdSchema.safeParse(kid).success ||
      !isEd25519PublicKey(x) ||
      Object.hasOwn(keys, kid)
    ) {
      context.addIssue({
        code: "custom",
        message: `"${entry}" is not a unique kid:key pair`,
      });
      return z.NEVER;
    }
    keys[kid] = x;
  }
  if (Object.keys(keys).length === 0) {
    context.addIssue({ code: "custom", message: "no license public key is configured" });
    return z.NEVER;
  }
  return keys;
});

/** Public keys by key id; each value is a raw Ed25519 public key in base64url. */
export type LicensePublicKeys = Readonly<Record<string, string>>;

/** Why a license was not accepted. */
export type LicenseRefusal =
  /** Not a compact JWS of a license, or its claims are invalid. */
  | "malformed"
  /** Signed with a key id this side does not know. */
  | "unknownKey"
  /** The signature does not verify with the key its key id names. */
  | "badSignature"
  /** Issued for another tenant. */
  | "otherTenant"
  /** Not issued after the installed license. */
  | "notNewer"
  /** Its `notBefore` is still in the future. */
  | "notYetValid";

export class LicenseRefusedError extends Error {
  override name = "LicenseRefusedError";
  readonly reason: LicenseRefusal;

  constructor(reason: LicenseRefusal, message: string, options?: { cause?: unknown }) {
    super(`license refused (${reason}): ${message}`, options);
    this.reason = reason;
  }
}

export interface VerifiedLicense {
  readonly kid: string;
  readonly claims: LicenseClaims;
}

/**
 * Verifies a license JWS against the public keys: `alg` EdDSA, `typ` license, a known `kid`,
 * a valid signature, and well-formed claims. Whether it fits a tenant, and whether it is
 * newer than the installed one, is for the caller.
 */
export async function verifyLicense(
  jws: string,
  keys: LicensePublicKeys,
): Promise<VerifiedLicense> {
  let kid = "";
  let payload: unknown;
  try {
    // A license is a JWS whose payload is a JSON object, so jwtVerify decodes it; the claims
    // are the license's own, checked below.
    ({ payload } = await jwtVerify(
      jws.trim(),
      async (header) => {
        const parsedKid = licenseKeyIdSchema.safeParse(header.kid);
        const x =
          parsedKid.success && Object.hasOwn(keys, parsedKid.data)
            ? keys[parsedKid.data]
            : undefined;
        if (!parsedKid.success || x === undefined) {
          throw new LicenseRefusedError(
            "unknownKey",
            `no public key has kid "${String(header.kid)}"`,
          );
        }
        kid = parsedKid.data;
        return importJWK({ kty: "OKP", crv: "Ed25519", x }, LICENSE_ALGORITHM);
      },
      { algorithms: [LICENSE_ALGORITHM], typ: LICENSE_TYPE },
    ));
  } catch (error) {
    if (error instanceof LicenseRefusedError) throw error;
    if (error instanceof errors.JWSSignatureVerificationFailed) {
      throw new LicenseRefusedError("badSignature", "the signature does not verify", {
        cause: error,
      });
    }
    throw new LicenseRefusedError("malformed", "not a license JWS", { cause: error });
  }

  const claims = licenseClaimsSchema.safeParse(payload);
  if (!claims.success) {
    throw new LicenseRefusedError("malformed", z.prettifyError(claims.error));
  }
  return { kid, claims: claims.data };
}

/** Whether `x` is a raw Ed25519 public key in base64url (32 bytes). */
function isEd25519PublicKey(x: string): boolean {
  try {
    return /^[A-Za-z0-9_-]{43}$/.test(x) && base64url.decode(x).length === 32;
  } catch {
    return false;
  }
}

/** The lifecycle states in order (ADR-0008); a license only moves forward through them. */
export const LICENSE_STATES = ["active", "expiring", "grace", "readOnly", "suspended"] as const;

export type LicenseState = (typeof LICENSE_STATES)[number];

/** The claims the lifecycle reads. */
export type LicenseTerms = Pick<LicenseClaims, "expiresAt" | "graceDays" | "readOnlyDays">;

/**
 * The instant each state after `active` begins (`core-foundation` rule 3): expiring
 * `EXPIRING_DAYS` before `expiresAt`, grace at `expiresAt`, read-only `graceDays` later,
 * suspended `readOnlyDays` after that. Days are 24-hour periods.
 */
export function licenseStateStarts(terms: LicenseTerms): Readonly<Record<LicenseState, number>> {
  const expiresAt = Date.parse(terms.expiresAt);
  const readOnly = expiresAt + terms.graceDays * MS_PER_DAY;
  return {
    active: Number.NEGATIVE_INFINITY,
    expiring: expiresAt - EXPIRING_DAYS * MS_PER_DAY,
    grace: expiresAt,
    readOnly,
    suspended: readOnly + terms.readOnlyDays * MS_PER_DAY,
  };
}

/**
 * The lifecycle state of a license at an instant (`core-foundation` rule 3) — a pure function
 * of the claims and the instant. Each boundary instant belongs to the later state; a state
 * with zero days is skipped.
 */
export function licenseState(terms: LicenseTerms, at: Date): LicenseState {
  const starts = licenseStateStarts(terms);
  const time = at.getTime();
  if (Number.isNaN(time)) throw new RangeError("the instant is not a valid date");
  let state: LicenseState = "active";
  for (const candidate of LICENSE_STATES) {
    if (time >= starts[candidate]) state = candidate;
  }
  return state;
}
