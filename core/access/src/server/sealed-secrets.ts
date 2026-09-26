import { createCipheriv, createDecipheriv } from "node:crypto";
import type { RandomSource } from "@mustawfi/kernel";

/**
 * The server keys that encrypt users' TOTP secrets at rest (`core-foundation` rule 26, open
 * question on the key's custody: a server secret file until `ops` defines the key procedure).
 * The current key seals new secrets; every listed key opens what it sealed, so a new key can be
 * added first and an old one removed once nothing sealed with it remains.
 */
export interface TotpKeyRing {
  /** The key id new secrets are sealed with. */
  readonly current: string;
  /** Every key by id: 32 bytes for AES-256-GCM. */
  readonly keys: ReadonlyMap<string, Uint8Array>;
}

/** The key ring was not valid: the reason names the line, never the key. */
export class TotpKeysInvalid extends Error {
  override name = "TotpKeysInvalid";
}

const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Reads a key ring file: one key per line, `kid:key` with the key 32 random bytes in base64url;
 * the first key is the current one. Blank lines and lines starting with `#` are ignored.
 * `pnpm --filter @mustawfi/server access:totp-key --kid <kid> --out <file>` writes a new file,
 * and with `--rotate` puts a new current key first in an existing one.
 */
export function parseTotpKeys(text: string): TotpKeyRing {
  const keys = new Map<string, Uint8Array>();
  let current: string | undefined;
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const where = `line ${String(index + 1)}`;
    const separator = line.indexOf(":");
    const kid = line.slice(0, separator);
    const encoded = line.slice(separator + 1);
    if (separator < 0 || !KEY_ID.test(kid)) {
      throw new TotpKeysInvalid(`${where}: expected kid:key, the kid 1–32 of A–Z a–z 0–9 _ -`);
    }
    const key = /^[A-Za-z0-9_-]+$/.test(encoded) ? Buffer.from(encoded, "base64url") : undefined;
    if (key?.length !== KEY_BYTES) {
      throw new TotpKeysInvalid(`${where}: the key of ${kid} is not 32 bytes in base64url`);
    }
    if (keys.has(kid)) throw new TotpKeysInvalid(`${where}: ${kid} is listed twice`);
    keys.set(kid, new Uint8Array(key));
    current ??= kid;
  }
  if (current === undefined) throw new TotpKeysInvalid("the file lists no key");
  return { current, keys };
}

/**
 * Encrypts `secret` with the ring's current key (AES-256-GCM, a fresh 96-bit nonce), bound to
 * `context` as associated data so a sealed value cannot be moved to another user or tenant.
 * The result is `v1.{kid}.{nonce}.{ciphertext and tag}`, base64url.
 */
export function sealSecret(
  ring: TotpKeyRing,
  secret: Uint8Array,
  context: string,
  random: RandomSource,
): string {
  const key = ring.keys.get(ring.current);
  if (key === undefined) throw new Error(`the current key ${ring.current} is not in the ring`);
  const iv = random.bytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const sealed = Buffer.concat([cipher.update(secret), cipher.final(), cipher.getAuthTag()]);
  return `v1.${ring.current}.${Buffer.from(iv).toString("base64url")}.${sealed.toString("base64url")}`;
}

/**
 * Decrypts what `sealSecret` returned for the same `context`. Throws when the key is not in the
 * ring or the value was altered or sealed for another context.
 */
export function openSecret(ring: TotpKeyRing, sealed: string, context: string): Uint8Array {
  const [version, kid, iv, body] = sealed.split(".");
  if (version !== "v1" || kid === undefined || iv === undefined || body === undefined) {
    throw new Error("not a sealed secret");
  }
  const key = ring.keys.get(kid);
  if (key === undefined)
    throw new Error(`the key ${kid} that sealed this secret is not in the ring`);
  const bytes = Buffer.from(body, "base64url");
  // The tag length is fixed: a shorter tag would be easier to forge.
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
  return new Uint8Array(
    Buffer.concat([decipher.update(bytes.subarray(0, bytes.length - TAG_BYTES)), decipher.final()]),
  );
}
