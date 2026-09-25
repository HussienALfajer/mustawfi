import { createHash } from "node:crypto";
import { seededRandom } from "@mustawfi/kernel";
import { describe, expect, it } from "vitest";
import {
  issueBearer,
  issueRegistrationSecret,
  readBearer,
  registrationCodeHash,
} from "./secrets.ts";

const TENANT = "0199a5c4-7b1e-7000-8000-000000000001";
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

describe("bearer secrets", () => {
  it("carry a kind tag, the tenant, and 256 random bits; the hash covers the whole token", () => {
    const { token, hash } = issueBearer("session", TENANT, seededRandom(1));
    expect(token).toMatch(new RegExp(`^s1\\.${TENANT}\\.[A-Za-z0-9_-]{43}$`));
    expect(hash).toBe(sha256(token));
    expect(readBearer("session", token)).toEqual({ tenantId: TENANT, hash });
  });

  it("differ with the randomness", () => {
    const first = issueBearer("device", TENANT, seededRandom(1)).token;
    expect(issueBearer("device", TENANT, seededRandom(2)).token).not.toBe(first);
  });

  it("are read only as their own kind and only when well formed", () => {
    const session = issueBearer("session", TENANT, seededRandom(3)).token;
    const device = issueBearer("device", TENANT, seededRandom(3)).token;
    expect(readBearer("device", session)).toBeUndefined();
    expect(readBearer("session", device)).toBeUndefined();
    for (const malformed of [
      "",
      `${session} `,
      `${session}=`,
      session.toUpperCase(),
      session.replace(TENANT, "not-a-tenant"),
      session.slice(0, -1),
    ]) {
      expect(readBearer("session", malformed)).toBeUndefined();
    }
  });
});

describe("registration codes", () => {
  it("are ten unambiguous symbols shown in two groups, hashed without the dash", () => {
    const { token, hash } = issueRegistrationSecret(seededRandom(4));
    expect(token).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    expect(hash).toBe(sha256(token.replace("-", "")));
  });

  it("forgive case, spaces, and dashes when typed, and refuse anything else", () => {
    const { token, hash } = issueRegistrationSecret(seededRandom(5));
    expect(registrationCodeHash(token)).toBe(hash);
    expect(registrationCodeHash(` ${token.toLowerCase().replace("-", " - ")} `)).toBe(hash);
    for (const malformed of ["", "ABCDE-FGHJ", "ABCDE-FGHJKL", "ABCDE-FGHJ1", "ABCDE_FGHJK"]) {
      expect(registrationCodeHash(malformed)).toBeUndefined();
    }
  });
});
