import { createHash } from "node:crypto";
import { randomCode, type RandomSource } from "@mustawfi/kernel";

/** 256 bits (ADR-0022). */
const SECRET_BYTES = 32;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** What a bearer secret opens: a user's session or a device's credential. */
export type BearerKind = "session" | "device";

const TAGS: Record<BearerKind, string> = { session: "s1", device: "d1" };

const FORMATS: Record<BearerKind, RegExp> = {
  session: new RegExp(`^s1\\.(${UUID})\\.[A-Za-z0-9_-]{43}$`),
  device: new RegExp(`^d1\\.(${UUID})\\.[A-Za-z0-9_-]{43}$`),
};

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface IssuedBearer {
  /** Handed to the client once and never stored. */
  readonly token: string;
  /** What the server stores and looks up. */
  readonly hash: string;
}

/**
 * A fresh bearer secret, `{kind tag}.{tenant id}.{256 random bits, base64url}` (ADR-0029).
 * The tenant id routes the lookup to its tenant under row-level security; the random part is
 * the secret. Clients treat the whole token as opaque.
 */
export function issueBearer(
  kind: BearerKind,
  tenantId: string,
  random: RandomSource,
): IssuedBearer {
  const secret = Buffer.from(random.bytes(SECRET_BYTES)).toString("base64url");
  const token = `${TAGS[kind]}.${tenantId}.${secret}`;
  return { token, hash: sha256Hex(token) };
}

/** The tenant and the stored hash of a well-formed bearer token of `kind`; else `undefined`. */
export function readBearer(
  kind: BearerKind,
  token: string,
): { readonly tenantId: string; readonly hash: string } | undefined {
  const match = FORMATS[kind].exec(token);
  const tenantId = match?.[1];
  return tenantId === undefined ? undefined : { tenantId, hash: sha256Hex(token) };
}

/**
 * Ten symbols of the unambiguous alphabet: 50 bits, shown as `ABCDE-FGHJK`. Registration codes
 * and support reset codes; both are short-lived and single use.
 */
const ONE_TIME_CODE_LENGTH = 10;

export function issueOneTimeCode(random: RandomSource): IssuedBearer {
  const code = randomCode(random, ONE_TIME_CODE_LENGTH);
  return { token: `${code.slice(0, 5)}-${code.slice(5)}`, hash: sha256Hex(code) };
}

/** The stored hash of a one-time code as typed: case, spaces, and dashes are forgiven. */
export function oneTimeCodeHash(typed: string): string | undefined {
  const code = typed.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-HJ-NP-Z2-9]{10}$/.test(code) ? sha256Hex(code) : undefined;
}
