import { createHash } from "node:crypto";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { type LocalDb, migrateLocalDb } from "@mustawfi/local-db";
import { openNodeLocalDb } from "@mustawfi/local-db/node";
import { CompactSign, exportJWK, generateKeyPair } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { BUNDLE_ALGORITHM, BUNDLE_TYPE, type SignedBundle } from "../shared/bundle.ts";
import {
  acceptBundle,
  type BundlePartDecoder,
  type BundleRefusal,
  BundleRefusedError,
  bundleStatus,
  type BundleVerifier,
  configLocalMigrations,
  loadBundle,
  verifyBundle,
} from "./bundle.ts";

const clock = manualClock(new Date("2026-09-26T10:00:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const device = { deviceId: newId(), tenantId: newId() };

interface TestKey {
  readonly kid: string;
  readonly x: string;
  readonly privateKey: CryptoKey;
}

async function testKey(kid: string): Promise<TestKey> {
  const { privateKey, publicKey } = await generateKeyPair(BUNDLE_ALGORITHM, {
    crv: "Ed25519",
    extractable: true,
  });
  const { x } = await exportJWK(publicKey);
  if (x === undefined) throw new Error("no public key");
  return { kid, x, privateKey };
}

const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("base64url");

/** Signs a bundle as the server does, with whatever the test wants to get wrong. */
async function signed(
  key: TestKey,
  options: {
    readonly version?: number;
    readonly deviceId?: string;
    readonly parts?: Record<string, unknown>;
    readonly typ?: string;
  } = {},
): Promise<SignedBundle> {
  const texts = Object.fromEntries(
    Object.entries(options.parts ?? PARTS).map(([name, value]) => [name, JSON.stringify(value)]),
  );
  const manifest = {
    version: options.version ?? 1,
    issuedAt: clock.now().toISOString(),
    deviceId: options.deviceId ?? device.deviceId,
    licenseRef: newId(),
    parts: Object.fromEntries(Object.entries(texts).map(([name, text]) => [name, digest(text)])),
  };
  const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(manifest)))
    .setProtectedHeader({ alg: BUNDLE_ALGORITHM, typ: options.typ ?? BUNDLE_TYPE, kid: key.kid })
    .sign(key.privateKey);
  return { manifest: jws, parts: texts };
}

/** Three parts shaped like the real ones' roles: a string, and two objects. */
const PARTS = {
  license: "a license JWS",
  access: { users: [{ id: "u1", pinVerifier: "$argon2id$…" }] },
  organization: { departments: [{ id: "d1", isDefault: true }] },
};

const decoder = (name: string, schema: z.ZodType): BundlePartDecoder => ({
  name,
  decode: (value) => schema.parse(value),
});

const DECODERS = [
  decoder("license", z.string()),
  decoder("access", z.object({ users: z.array(z.object({ id: z.string() }).loose()) })),
  decoder("organization", z.object({ departments: z.array(z.unknown()).min(1) })),
];

let current: TestKey;
let next: TestKey;
let verifier: BundleVerifier;

beforeEach(async () => {
  current = await testKey("bundle-2026");
  next = await testKey("bundle-2027");
  verifier = { keys: { [current.kid]: current.x, [next.kid]: next.x }, decoders: DECODERS };
});

async function refusal(bundle: SignedBundle, using = verifier): Promise<BundleRefusal> {
  const error: unknown = await verifyBundle(bundle, using, device).catch((e: unknown) => e);
  if (!(error instanceof BundleRefusedError)) throw new Error("the bundle was not refused");
  return error.reason;
}

describe("verifying a configuration bundle (rule 11)", () => {
  it("verifies the signature and every part, and returns the decoded parts", async () => {
    const verified = await verifyBundle(await signed(current, { version: 3 }), verifier, device);
    expect(verified.version).toBe(3);
    expect(verified.parts).toEqual(PARTS);
  });

  it("trusts the next key too, so a rotation needs no new app (ADR-0021)", async () => {
    await expect(verifyBundle(await signed(next), verifier, device)).resolves.toMatchObject({
      version: 1,
    });
  });

  it("refuses a key id it does not trust", async () => {
    const stranger = await testKey("somebody-else");
    expect(await refusal(await signed(stranger))).toBe("unknownKey");
  });

  it("refuses a signature by another key under a trusted key id", async () => {
    const impostor = { ...(await testKey(current.kid)) };
    expect(await refusal(await signed(impostor))).toBe("badSignature");
  });

  it("refuses a manifest whose payload was changed after signing", async () => {
    const bundle = await signed(current);
    const [header, , signature] = bundle.manifest.split(".");
    const payload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(bundle.manifest.split(".")[1] ?? "", "base64url").toString()),
        version: 99,
      }),
    ).toString("base64url");
    expect(
      await refusal({ ...bundle, manifest: `${String(header)}.${payload}.${String(signature)}` }),
    ).toBe("badSignature");
  });

  it("refuses a token of another type, such as a license signed by mistake", async () => {
    expect(await refusal(await signed(current, { typ: "mustawfi-license" }))).toBe("malformed");
  });

  it("refuses a bundle built for another device", async () => {
    expect(await refusal(await signed(current, { deviceId: newId() }))).toBe("otherDevice");
  });

  for (const name of Object.keys(PARTS)) {
    it(`refuses a bundle whose ${name} part does not match its hash`, async () => {
      const bundle = await signed(current);
      const tampered = {
        ...bundle,
        parts: { ...bundle.parts, [name]: `${bundle.parts[name] ?? ""} ` },
      };
      expect(await refusal(tampered)).toBe("badHash");
    });

    it(`refuses a bundle whose ${name} part is missing`, async () => {
      const bundle = await signed(current);
      const parts = Object.fromEntries(
        Object.entries(bundle.parts).filter(([partName]) => partName !== name),
      );
      expect(await refusal({ ...bundle, parts })).toBe("partMissing");
    });

    it(`refuses a signed bundle whose ${name} part its module refuses`, async () => {
      const bundle = await signed(current, { parts: { ...PARTS, [name]: 42 } });
      expect(await refusal(bundle)).toBe("badPart");
    });
  }

  it("refuses a bundle without a part this app needs, even when the manifest agrees", async () => {
    const parts = { license: PARTS.license, access: PARTS.access };
    expect(await refusal(await signed(current, { parts }))).toBe("partMissing");
  });

  it("refuses a part the manifest does not name", async () => {
    const bundle = await signed(current);
    expect(await refusal({ ...bundle, parts: { ...bundle.parts, extra: "{}" } })).toBe("malformed");
  });

  it("checks a part no decoder knows by its hash, and leaves it undecoded", async () => {
    const bundle = await signed(current, { parts: { ...PARTS, settings: { a: 1 } } });
    await expect(verifyBundle(bundle, verifier, device)).resolves.toMatchObject({
      parts: PARTS,
    });
    const tampered = { ...bundle, parts: { ...bundle.parts, settings: '{"a":2}' } };
    expect(await refusal(tampered)).toBe("badHash");
  });
});

describe("the bundle on the device", () => {
  let db: LocalDb;

  beforeEach(async () => {
    db = openNodeLocalDb(":memory:");
    await migrateLocalDb(db, configLocalMigrations);
  });

  afterEach(async () => {
    await db.close();
  });

  const accept = (bundle: SignedBundle | null, version = 1) =>
    acceptBundle(db, { version, bundle }, verifier, device, clock);

  it("has none until the first one arrives", async () => {
    expect(await loadBundle(db, verifier, device)).toEqual({ state: "none" });
    expect(await bundleStatus(db)).toEqual({ version: null, verifiedAt: null, refusal: null });
  });

  it("stores a valid bundle and reads it back verified", async () => {
    expect(await accept(await signed(current, { version: 2 }), 2)).toEqual({
      outcome: "accepted",
      version: 2,
    });
    const loaded = await loadBundle(db, verifier, device);
    expect(loaded).toMatchObject({ state: "valid", bundle: { version: 2, parts: PARTS } });
    expect(await accept(null, 2)).toEqual({ outcome: "unchanged", version: 2 });
  });

  it("keeps the previous bundle and records the refusal of a bad one, until a valid one", async () => {
    await accept(await signed(current, { version: 1 }));
    const bad = await signed(current, { version: 2 });
    expect(await accept({ ...bad, parts: { ...bad.parts, access: '{"users":[]}' } }, 2)).toEqual({
      outcome: "refused",
      reason: "badHash",
    });
    expect(await loadBundle(db, verifier, device)).toMatchObject({
      state: "refused",
      reason: "badHash",
      bundle: { version: 1, parts: PARTS },
    });
    expect(await bundleStatus(db)).toMatchObject({
      version: 1,
      refusal: { reason: "badHash", refusedAt: "2026-09-26T10:00:00.000Z" },
    });

    await accept(await signed(current, { version: 3 }), 3);
    expect(await loadBundle(db, verifier, device)).toMatchObject({
      state: "valid",
      bundle: { version: 3 },
    });
    expect((await bundleStatus(db)).refusal).toBeNull();
  });

  it("refuses an older bundle than the one it holds, so a replay cannot undo a change", async () => {
    await accept(await signed(current, { version: 5 }), 5);
    expect(await accept(await signed(current, { version: 4 }), 4)).toEqual({
      outcome: "refused",
      reason: "stale",
    });
    expect(await loadBundle(db, verifier, device)).toMatchObject({ bundle: { version: 5 } });
  });

  it("does not trust a stored bundle edited in the local database", async () => {
    await accept(await signed(current));
    const [row] = await db.query("SELECT parts FROM config_bundle");
    const parts = JSON.parse(String(row?.["parts"])) as Record<string, string>;
    parts["access"] = JSON.stringify({ users: [{ id: "u1", pinVerifier: "$argon2id$mine" }] });
    await db.run("UPDATE config_bundle SET parts = ?", [JSON.stringify(parts)]);
    expect(await loadBundle(db, verifier, device)).toEqual({
      state: "refused",
      reason: "badHash",
      bundle: undefined,
    });
  });
});
