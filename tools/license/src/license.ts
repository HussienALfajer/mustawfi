import {
  LICENSE_ALGORITHM,
  LICENSE_TYPE,
  type LicenseClaims,
  licenseClaimsSchema,
  licenseKeyIdSchema,
  type LicenseLimits,
} from "@mustawfi/core-tenancy/shared";
import { CompactSign, exportJWK, generateKeyPair, importJWK, type JWK } from "jose";
import { z } from "zod";
import { LICENSE_DEFAULTS, PLANS, type PlanCode } from "./plans.ts";

const MS_PER_DAY = 86_400_000;

/** A license private key as `license:keygen` writes it: an Ed25519 JWK with its key id. */
export const licensePrivateKeySchema = z.object({
  kty: z.literal("OKP"),
  crv: z.literal("Ed25519"),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  d: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  kid: licenseKeyIdSchema,
});

export type LicensePrivateKey = z.infer<typeof licensePrivateKeySchema>;

export interface LicenseKeyPair {
  readonly privateKey: LicensePrivateKey;
  /** The entry for `LICENSE_PUBLIC_KEYS`: `kid:x`. */
  readonly publicKey: string;
}

/** A fresh Ed25519 key pair for signing licenses (ADR-0021). */
export async function generateLicenseKeyPair(kid: string): Promise<LicenseKeyPair> {
  const { privateKey } = await generateKeyPair(LICENSE_ALGORITHM, {
    crv: "Ed25519",
    extractable: true,
  });
  const jwk: JWK = await exportJWK(privateKey);
  const parsed = licensePrivateKeySchema.parse({ ...jwk, kid: licenseKeyIdSchema.parse(kid) });
  return { privateKey: parsed, publicKey: `${parsed.kid}:${parsed.x}` };
}

/** Signs the claims as a license JWS (`alg` EdDSA, `typ` license, the key's `kid`). */
export async function issueLicense(
  claims: LicenseClaims,
  privateKey: LicensePrivateKey,
): Promise<string> {
  const payload = licenseClaimsSchema.parse(claims);
  const { kid, ...jwk } = licensePrivateKeySchema.parse(privateKey);
  const key = await importJWK(jwk, LICENSE_ALGORITHM);
  return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: LICENSE_ALGORITHM, typ: LICENSE_TYPE, kid })
    .sign(key);
}

export interface LicenseTermsInput {
  readonly tenant: string;
  readonly plan: PlanCode;
  readonly issuedAt: Date;
  /** Defaults to `issuedAt`. */
  readonly notBefore?: Date;
  /** Defaults to one year after `notBefore`. */
  readonly expiresAt?: Date;
  readonly graceDays?: number;
  readonly readOnlyDays?: number;
  readonly maxOfflineDays?: number;
  /** Per-tenant overrides of the plan's limits (`--limit users=8`). */
  readonly limits?: Partial<LicenseLimits>;
}

/** The claims of a license for a plan, with the commercial defaults and any overrides. */
export function licenseClaimsFor(input: LicenseTermsInput): LicenseClaims {
  const plan = PLANS[input.plan];
  const notBefore = input.notBefore ?? input.issuedAt;
  const expiresAt =
    input.expiresAt ?? new Date(notBefore.getTime() + LICENSE_DEFAULTS.validDays * MS_PER_DAY);
  return licenseClaimsSchema.parse({
    tenant: input.tenant,
    plan: input.plan,
    issuedAt: input.issuedAt.toISOString(),
    notBefore: notBefore.toISOString(),
    expiresAt: expiresAt.toISOString(),
    graceDays: input.graceDays ?? LICENSE_DEFAULTS.graceDays,
    readOnlyDays: input.readOnlyDays ?? LICENSE_DEFAULTS.readOnlyDays,
    maxOfflineDays: input.maxOfflineDays ?? LICENSE_DEFAULTS.maxOfflineDays,
    limits: { ...plan.limits, ...input.limits },
    entitlements: [...plan.entitlements],
  });
}
