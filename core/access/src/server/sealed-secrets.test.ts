import { cryptoRandom } from "@mustawfi/kernel";
import { describe, expect, it } from "vitest";
import { openSecret, parseTotpKeys, sealSecret, TotpKeysInvalid } from "./sealed-secrets.ts";

const bytes = (length: number) => Buffer.from(cryptoRandom.bytes(length));
const key = () => bytes(32).toString("base64url");
const SECRET = new Uint8Array(bytes(20));
const CONTEXT = "core_access.users.totp_secret:tenant-a:user-a";

describe("TOTP key ring (core-foundation rule 26)", () => {
  it("reads kid:key lines, the first being current, skipping blanks and comments", () => {
    const ring = parseTotpKeys(`# rotated 2026-09\n\nk2:${key()}\r\nk1:${key()}\n`);
    expect(ring.current).toBe("k2");
    expect([...ring.keys.keys()]).toEqual(["k2", "k1"]);
    expect(ring.keys.get("k1")).toHaveLength(32);
  });

  it.each([
    ["an empty file", "\n# nothing\n"],
    ["a line without a kid", `${key()}`],
    ["a kid with a space", `k 1:${key()}`],
    ["a short key", `k1:${bytes(16).toString("base64url")}`],
    ["a key that is not base64url", `k1:${bytes(32).toString("base64")}+/`],
    ["a kid listed twice", `k1:${key()}\nk1:${key()}`],
  ])("refuses %s, naming no key", (_, text) => {
    let error: unknown;
    try {
      parseTotpKeys(text);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(TotpKeysInvalid);
    for (const line of text.split("\n")) {
      const secret = line.split(":")[1];
      if (secret !== undefined && secret.length > 8) {
        expect((error as Error).message).not.toContain(secret);
      }
    }
  });
});

describe("sealed secrets", () => {
  const ring = parseTotpKeys(`k2:${key()}\nk1:${key()}`);

  it("seals with the current key and opens the same bytes, never showing them", () => {
    const sealed = sealSecret(ring, SECRET, CONTEXT, cryptoRandom);
    expect(sealed).toMatch(/^v1\.k2\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain(Buffer.from(SECRET).toString("base64url"));
    expect(openSecret(ring, sealed, CONTEXT)).toEqual(SECRET);
    // A fresh nonce each time.
    expect(sealSecret(ring, SECRET, CONTEXT, cryptoRandom)).not.toBe(sealed);
  });

  it("opens what an older key of the ring sealed", () => {
    const older = parseTotpKeys(
      `k1:${Buffer.from(ring.keys.get("k1") ?? []).toString("base64url")}`,
    );
    const sealed = sealSecret(older, SECRET, CONTEXT, cryptoRandom);
    expect(sealed.startsWith("v1.k1.")).toBe(true);
    expect(openSecret(ring, sealed, CONTEXT)).toEqual(SECRET);
  });

  it("refuses another user's context, an altered value, and a key not in the ring", () => {
    const sealed = sealSecret(ring, SECRET, CONTEXT, cryptoRandom);
    expect(() =>
      openSecret(ring, sealed, "core_access.users.totp_secret:tenant-a:user-b"),
    ).toThrow();

    const [version, kid, iv, body = ""] = sealed.split(".");
    const flipped = Buffer.from(body, "base64url");
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() =>
      openSecret(ring, [version, kid, iv, flipped.toString("base64url")].join("."), CONTEXT),
    ).toThrow();
    // A truncated tag is not accepted as a shorter one.
    expect(() =>
      openSecret(ring, [version, kid, iv, body.slice(0, body.length - 8)].join("."), CONTEXT),
    ).toThrow();
    expect(() => openSecret(parseTotpKeys(`k9:${key()}`), sealed, CONTEXT)).toThrow(/k2/);
    expect(() => openSecret(ring, "not sealed", CONTEXT)).toThrow();
  });
});
