import { createHash } from "node:crypto";
import { CompactSign, importJWK } from "jose";
import { z } from "zod";
import {
  BUNDLE_ALGORITHM,
  BUNDLE_TYPE,
  type BundleManifest,
  bundleManifestSchema,
  SERVER_TIME_TYPE,
  serverTimeClaimsSchema,
  type SignedBundle,
  signingKeyIdSchema,
} from "../shared/bundle.ts";

/**
 * Signing the configuration bundle on the tenant server (ADR-0021, ADR-0030). The server holds
 * the bundle key only — never a license key.
 */

/** A bundle private key as its key file holds it: an Ed25519 JWK with its key id. */
const bundlePrivateKeySchema = z.object({
  kty: z.literal("OKP"),
  crv: z.literal("Ed25519"),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  d: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  kid: signingKeyIdSchema,
});

export interface BundleSigningKey {
  readonly kid: string;
  /** The entry devices trust it by (`VITE_BUNDLE_PUBLIC_KEYS`): `kid:x`. */
  readonly publicKey: string;
  readonly key: Awaited<ReturnType<typeof importJWK>>;
}

export class BundleKeyInvalid extends Error {
  override name = "BundleKeyInvalid";
}

/**
 * Reads the bundle key file (`BUNDLE_KEY_FILE`): one Ed25519 private JWK with `kid`, as
 * `bundle:keygen` writes it. The refusal never quotes the key.
 */
export async function parseBundleSigningKey(text: string): Promise<BundleSigningKey> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BundleKeyInvalid("the bundle key file is not JSON");
  }
  const parsed = bundlePrivateKeySchema.safeParse(json);
  if (!parsed.success) {
    throw new BundleKeyInvalid("the bundle key file is not an Ed25519 private JWK with a kid");
  }
  const { kid, ...jwk } = parsed.data;
  return {
    kid,
    publicKey: `${kid}:${jwk.x}`,
    key: await importJWK(jwk, BUNDLE_ALGORITHM),
  };
}

/** Who a bundle is built for. */
export interface BundleDevice {
  readonly tenantId: string;
  readonly deviceId: string;
}

/**
 * A part a module contributes to every device's bundle (ADR-0030); the host composes them as it
 * composes sync operations. `build` runs in the tenant transaction `Tx` of the request and
 * returns a JSON value, which must come out the same for the same data: the version changes
 * only when some part's text does (rule 12).
 */
export interface BundlePart<Tx> {
  readonly name: string;
  build(tx: Tx, device: BundleDevice): Promise<unknown>;
}

/** The SHA-256 of a part's text (its UTF-8 bytes) in base64url, as the manifest names it. */
export function partDigest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("base64url");
}

/** One digest over every part's name and digest: whether anything in the bundle changed. */
export function bundleDigest(parts: Readonly<Record<string, string>>): string {
  const lines = Object.keys(parts)
    .sort()
    .map((name) => `${name}:${partDigest(parts[name] ?? "")}`);
  return partDigest(lines.join("\n"));
}

export interface BundleContents {
  readonly version: number;
  readonly issuedAt: Date;
  readonly deviceId: string;
  readonly licenseRef: string;
  /** Each part's JSON text by part name. */
  readonly parts: Readonly<Record<string, string>>;
}

/** Signs the manifest of `contents` with the bundle key (`alg` EdDSA, `typ` bundle, `kid`). */
export async function signBundle(
  contents: BundleContents,
  key: BundleSigningKey,
): Promise<SignedBundle> {
  const manifest: BundleManifest = bundleManifestSchema.parse({
    version: contents.version,
    issuedAt: contents.issuedAt.toISOString(),
    deviceId: contents.deviceId,
    licenseRef: contents.licenseRef,
    parts: Object.fromEntries(
      Object.keys(contents.parts)
        .sort()
        .map((name) => [name, partDigest(contents.parts[name] ?? "")]),
    ),
  });
  const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(manifest)))
    .setProtectedHeader({ alg: BUNDLE_ALGORITHM, typ: BUNDLE_TYPE, kid: key.kid })
    .sign(key.key);
  return { manifest: jws, parts: { ...contents.parts } };
}

/**
 * Signs the server's time for one device with the bundle key (`typ` time): the trusted server
 * time of the device's clock guard (ADR-0021). It names the device, so another device cannot
 * use it, and devices take only a time later than the last one they took, so it cannot be
 * replayed.
 */
export async function signServerTime(
  deviceId: string,
  at: Date,
  key: BundleSigningKey,
): Promise<string> {
  const claims = serverTimeClaimsSchema.parse({ deviceId, serverTime: at.toISOString() });
  return new CompactSign(new TextEncoder().encode(JSON.stringify(claims)))
    .setProtectedHeader({ alg: BUNDLE_ALGORITHM, typ: SERVER_TIME_TYPE, kid: key.kid })
    .sign(key.key);
}
