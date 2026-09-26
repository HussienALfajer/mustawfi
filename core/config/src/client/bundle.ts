import type { Clock } from "@mustawfi/kernel";
import {
  type LocalDb,
  type LocalExecutor,
  type LocalMigration,
  localOrm,
  safeInteger,
} from "@mustawfi/local-db";
import { queryOptions } from "@tanstack/react-query";
import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { base64url, errors, importJWK, jwtVerify } from "jose";
import { z } from "zod";
import {
  BUNDLE_ALGORITHM,
  BUNDLE_TYPE,
  type BundleManifest,
  bundleManifestSchema,
  type BundleResponse,
  type PublicKeyRing,
  type SignedBundle,
  signedBundleSchema,
  signingKeyIdSchema,
} from "../shared/bundle.ts";

/**
 * The configuration bundle on the device (ADR-0021, ADR-0030, `core-foundation` rules 11–12):
 * verified before it is stored, stored exactly as received, and verified again whenever it is
 * read, so a local database edited by hand is not trusted either.
 */

/** The device the bundle must be for. */
export interface BundleDevice {
  readonly deviceId: string;
  readonly tenantId: string;
}

/**
 * What a module makes of its part on the device: it checks the part's content and returns it
 * typed, or throws to refuse the whole bundle. Each module's client exports its own; the app
 * composes them.
 */
export interface BundlePartDecoder<T = unknown> {
  readonly name: string;
  decode(value: unknown, device: BundleDevice): T | Promise<T>;
}

/** How a device checks bundles: the public keys it ships with and its modules' decoders. */
export interface BundleVerifier {
  /** The bundle keys by key id: the current one and the next (ADR-0021). */
  readonly keys: PublicKeyRing;
  readonly decoders: readonly BundlePartDecoder[];
}

/** Why a bundle was not used (rule 11). */
export type BundleRefusal =
  /** Not a bundle: the manifest or its parts do not parse. */
  | "malformed"
  /** Signed with a key id this device does not trust. */
  | "unknownKey"
  /** The signature does not verify with the key its key id names. */
  | "badSignature"
  /** Built for another device. */
  | "otherDevice"
  /** A part the manifest names is missing, or a part this app needs is not in the manifest. */
  | "partMissing"
  /** A part's text does not hash to what the manifest says. */
  | "badHash"
  /** A part hashes right but its module refuses its content. */
  | "badPart"
  /** Older than the bundle the device already holds. */
  | "stale";

export class BundleRefusedError extends Error {
  override name = "BundleRefusedError";
  readonly reason: BundleRefusal;

  constructor(reason: BundleRefusal, message: string, options?: { cause?: unknown }) {
    super(`bundle refused (${reason}): ${message}`, options);
    this.reason = reason;
  }
}

export interface VerifiedBundle {
  readonly version: number;
  readonly issuedAt: string;
  readonly licenseRef: string;
  /** Each decoded part by name: what its decoder returned. */
  readonly parts: Readonly<Record<string, unknown>>;
}

/** The SHA-256 of `text`'s UTF-8 bytes in base64url, as the manifest names a part. */
async function partDigest(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return base64url.encode(new Uint8Array(digest));
}

async function verifiedManifest(jws: string, keys: PublicKeyRing): Promise<BundleManifest> {
  let payload: unknown;
  try {
    // The manifest is a JWS whose payload is a JSON object, so jwtVerify decodes it; it carries
    // no JWT time claims, so only the signature, `alg`, and `typ` are checked here.
    ({ payload } = await jwtVerify(
      jws,
      async (header) => {
        const kid = signingKeyIdSchema.safeParse(header.kid);
        const x = kid.success && Object.hasOwn(keys, kid.data) ? keys[kid.data] : undefined;
        if (!kid.success || x === undefined) {
          throw new BundleRefusedError(
            "unknownKey",
            `no bundle key has kid "${String(header.kid)}"`,
          );
        }
        return importJWK({ kty: "OKP", crv: "Ed25519", x }, BUNDLE_ALGORITHM);
      },
      { algorithms: [BUNDLE_ALGORITHM], typ: BUNDLE_TYPE },
    ));
  } catch (error) {
    if (error instanceof BundleRefusedError) throw error;
    if (error instanceof errors.JWSSignatureVerificationFailed) {
      throw new BundleRefusedError("badSignature", "the signature does not verify", {
        cause: error,
      });
    }
    throw new BundleRefusedError("malformed", "not a bundle manifest", { cause: error });
  }
  const manifest = bundleManifestSchema.safeParse(payload);
  if (!manifest.success) {
    throw new BundleRefusedError("malformed", z.prettifyError(manifest.error));
  }
  return manifest.data;
}

/**
 * Verifies a bundle for `device` (rule 11): the manifest's signature with a trusted key, the
 * device it names, every part's hash, and every part this app decodes. A part the manifest
 * names but no decoder knows (a newer server's) is checked by its hash and left undecoded.
 * Refusals throw `BundleRefusedError`.
 */
export async function verifyBundle(
  bundle: SignedBundle,
  verifier: BundleVerifier,
  device: BundleDevice,
): Promise<VerifiedBundle> {
  const signed = signedBundleSchema.safeParse(bundle);
  if (!signed.success) throw new BundleRefusedError("malformed", z.prettifyError(signed.error));
  const manifest = await verifiedManifest(signed.data.manifest, verifier.keys);
  if (manifest.deviceId !== device.deviceId) {
    throw new BundleRefusedError("otherDevice", `the bundle is for device ${manifest.deviceId}`);
  }
  const texts = signed.data.parts;
  for (const name of Object.keys(texts)) {
    if (!Object.hasOwn(manifest.parts, name)) {
      throw new BundleRefusedError("malformed", `part ${name} is not in the manifest`);
    }
  }
  for (const [name, digest] of Object.entries(manifest.parts)) {
    const text = Object.hasOwn(texts, name) ? texts[name] : undefined;
    if (text === undefined) throw new BundleRefusedError("partMissing", `part ${name} is missing`);
    if ((await partDigest(text)) !== digest) {
      throw new BundleRefusedError("badHash", `part ${name} does not match its hash`);
    }
  }
  const parts: Record<string, unknown> = {};
  for (const decoder of verifier.decoders) {
    const text = Object.hasOwn(texts, decoder.name) ? texts[decoder.name] : undefined;
    if (text === undefined) {
      throw new BundleRefusedError("partMissing", `the bundle has no ${decoder.name} part`);
    }
    try {
      parts[decoder.name] = await decoder.decode(JSON.parse(text), device);
    } catch (error) {
      throw new BundleRefusedError("badPart", `the ${decoder.name} part is refused`, {
        cause: error,
      });
    }
  }
  return {
    version: manifest.version,
    issuedAt: manifest.issuedAt,
    licenseRef: manifest.licenseRef,
    parts,
  };
}

/** The bundle in use, exactly as received: at most one row. */
const configBundle = sqliteTable("config_bundle", {
  id: integer().primaryKey(),
  version: safeInteger().notNull(),
  /** The manifest JWS. */
  manifest: text().notNull(),
  /** JSON object of each part's text by name. */
  parts: text().notNull(),
  verifiedAt: text("verified_at").notNull(),
});

/**
 * The last bundle refused since a valid one arrived: at most one row. While it is there the
 * device is read-only (rule 11, enforced from slice 13).
 */
const configBundleRefusal = sqliteTable("config_bundle_refusal", {
  id: integer().primaryKey(),
  reason: text().notNull(),
  /** The version the server offered, when the refused bundle could be read that far. */
  version: safeInteger(),
  refusedAt: text("refused_at").notNull(),
});

export const CONFIG_BUNDLE_TABLE = "config_bundle";
export const CONFIG_BUNDLE_REFUSAL_TABLE = "config_bundle_refusal";

/** `core.config`'s local schema (ADR-0019). */
export const configLocalMigrations: readonly LocalMigration[] = [
  {
    id: "core.config.0001_bundle",
    statements: [
      `CREATE TABLE config_bundle (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL CHECK (version > 0),
        manifest TEXT NOT NULL,
        parts TEXT NOT NULL,
        verified_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE config_bundle_refusal (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        reason TEXT NOT NULL,
        version INTEGER,
        refused_at TEXT NOT NULL
      ) STRICT`,
    ],
  },
];

const storedPartsSchema = z.record(z.string(), z.string());

async function storedBundle(executor: LocalExecutor) {
  return localOrm(executor).select().from(configBundle).where(eq(configBundle.id, 1)).get();
}

/** The version of the bundle stored on this device, 0 for none. */
export async function storedBundleVersion(executor: LocalExecutor): Promise<number> {
  return (await storedBundle(executor))?.version ?? 0;
}

export type BundleOutcome =
  | { readonly outcome: "unchanged"; readonly version: number }
  | { readonly outcome: "accepted"; readonly version: number }
  | { readonly outcome: "refused"; readonly reason: BundleRefusal };

/**
 * Takes what `GET /api/v1/sync/bundle` answered: a new bundle is verified and, when valid,
 * replaces the stored one and clears any refusal, in one local transaction. A refused one is
 * recorded and the previous bundle stays (rule 11).
 */
export async function acceptBundle(
  db: LocalDb,
  response: BundleResponse,
  verifier: BundleVerifier,
  device: BundleDevice,
  clock: Clock,
): Promise<BundleOutcome> {
  const stored = await storedBundleVersion(db);
  if (response.bundle === null) return { outcome: "unchanged", version: stored };
  const bundle = response.bundle;
  let verified: VerifiedBundle;
  try {
    verified = await verifyBundle(bundle, verifier, device);
    // A replayed older bundle must not bring back what a newer one took away.
    if (verified.version <= stored) {
      throw new BundleRefusedError(
        "stale",
        `version ${String(verified.version)} is not newer than ${String(stored)}`,
      );
    }
  } catch (error) {
    if (!(error instanceof BundleRefusedError)) throw error;
    const refusal = {
      reason: error.reason,
      version: response.version,
      refusedAt: clock.now().toISOString(),
    };
    await localOrm(db)
      .insert(configBundleRefusal)
      .values({ id: 1, ...refusal })
      .onConflictDoUpdate({ target: configBundleRefusal.id, set: refusal });
    return { outcome: "refused", reason: error.reason };
  }
  await db.transaction(async (tx) => {
    const row = {
      version: verified.version,
      manifest: bundle.manifest,
      parts: JSON.stringify(bundle.parts),
      verifiedAt: clock.now().toISOString(),
    };
    await localOrm(tx)
      .insert(configBundle)
      .values({ id: 1, ...row })
      .onConflictDoUpdate({ target: configBundle.id, set: row });
    await localOrm(tx).delete(configBundleRefusal);
  });
  return { outcome: "accepted", version: verified.version };
}

export type LoadedBundle =
  /** A verified bundle, and no refusal since it arrived. */
  | { readonly state: "valid"; readonly bundle: VerifiedBundle }
  /** No bundle yet: a device just registered, or one that has not synced since. */
  | { readonly state: "none" }
  /**
   * The last bundle offered was refused, or the stored one no longer verifies. `bundle` is the
   * stored one while it still verifies (rule 11 keeps it; the device is read-only meanwhile).
   */
  | {
      readonly state: "refused";
      readonly reason: BundleRefusal;
      readonly bundle: VerifiedBundle | undefined;
    };

/**
 * The bundle this device uses, verified again as it is read (ADR-0021: at start-up and before
 * creating a document): signature, device, hashes, and decoded parts.
 */
export async function loadBundle(
  executor: LocalExecutor,
  verifier: BundleVerifier,
  device: BundleDevice,
): Promise<LoadedBundle> {
  const row = await storedBundle(executor);
  const refusal = await localOrm(executor)
    .select()
    .from(configBundleRefusal)
    .where(eq(configBundleRefusal.id, 1))
    .get();
  let bundle: VerifiedBundle | undefined;
  let storedRefusal: BundleRefusal | undefined;
  if (row !== undefined) {
    try {
      const parts = storedPartsSchema.parse(JSON.parse(row.parts));
      bundle = await verifyBundle({ manifest: row.manifest, parts }, verifier, device);
      if (bundle.version !== row.version) {
        throw new BundleRefusedError("malformed", "the stored version is not the manifest's");
      }
    } catch (error) {
      bundle = undefined;
      storedRefusal = error instanceof BundleRefusedError ? error.reason : "malformed";
    }
  }
  if (storedRefusal !== undefined) return { state: "refused", reason: storedRefusal, bundle };
  if (refusal !== undefined) {
    return { state: "refused", reason: refusal.reason as BundleRefusal, bundle };
  }
  return bundle === undefined ? { state: "none" } : { state: "valid", bundle };
}

/** What the device screen shows of the bundle, from the stored rows, without verifying. */
export interface BundleStatus {
  readonly version: number | null;
  readonly verifiedAt: string | null;
  readonly refusal: { readonly reason: BundleRefusal; readonly refusedAt: string } | null;
}

export async function bundleStatus(executor: LocalExecutor): Promise<BundleStatus> {
  const row = await storedBundle(executor);
  const refusal = await localOrm(executor).select().from(configBundleRefusal).get();
  return {
    version: row?.version ?? null,
    verifiedAt: row?.verifiedAt ?? null,
    refusal:
      refusal === undefined
        ? null
        : { reason: refusal.reason as BundleRefusal, refusedAt: refusal.refusedAt },
  };
}

/** The bundle this device uses, verified as `loadBundle` reads it, for screens that show it. */
export function loadedBundleQueryOptions(
  db: LocalDb,
  verifier: BundleVerifier,
  device: BundleDevice,
) {
  return queryOptions({
    queryKey: ["local", "config", "bundle", "loaded", device.deviceId] as const,
    queryFn: () => loadBundle(db, verifier, device),
    networkMode: "always",
    meta: { localTables: [CONFIG_BUNDLE_TABLE, CONFIG_BUNDLE_REFUSAL_TABLE] },
  });
}

export function bundleStatusQueryOptions(db: LocalDb) {
  return queryOptions({
    queryKey: ["local", "config", "bundle"] as const,
    queryFn: () => bundleStatus(db),
    networkMode: "always",
    meta: { localTables: [CONFIG_BUNDLE_TABLE, CONFIG_BUNDLE_REFUSAL_TABLE] },
  });
}
