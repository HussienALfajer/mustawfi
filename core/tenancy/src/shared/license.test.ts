import { fc, test } from "@fast-check/vitest";
import {
  base64url,
  type CryptoKey,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  SignJWT,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  businessDate,
  EXPIRING_DAYS,
  isReadOnlyState,
  LICENSE_STATES,
  type LicenseClaims,
  licensePublicKeysSchema,
  type LicenseRefusal,
  LicenseRefusedError,
  licenseState,
  licenseStateStarts,
  type LicenseTerms,
  readOnlyBusinessDate,
  verifyLicense,
} from "./license.ts";

const DAY = 86_400_000;

const claims: LicenseClaims = {
  tenant: "0199a0b4-7c3e-7000-8000-000000000001",
  plan: "phonesPro",
  issuedAt: "2026-09-25T08:00:00.000Z",
  notBefore: "2026-09-25T08:00:00.000Z",
  expiresAt: "2027-09-25T08:00:00.000Z",
  graceDays: 7,
  readOnlyDays: 30,
  maxOfflineDays: 10,
  limits: { users: 6, departments: 4, mainPosDevices: 3, companionDevices: 2 },
  entitlements: ["serials", "repairs", "recharge"],
};

describe("verifyLicense", () => {
  let privateKey: CryptoKey;
  let otherPrivateKey: CryptoKey;
  let keys: Record<string, string>;

  const sign = (
    payload: unknown,
    header: Record<string, unknown> = {},
    key: CryptoKey = privateKey,
  ) =>
    new SignJWT(payload as JWTPayload)
      .setProtectedHeader({ alg: "EdDSA", typ: "mustawfi-license", kid: "k1", ...header })
      .sign(key);

  async function refusal(jws: string): Promise<LicenseRefusal | "accepted"> {
    try {
      await verifyLicense(jws, keys);
      return "accepted";
    } catch (error) {
      if (error instanceof LicenseRefusedError) return error.reason;
      throw error;
    }
  }

  beforeAll(async () => {
    const pair = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    privateKey = pair.privateKey;
    otherPrivateKey = (await generateKeyPair("EdDSA", { crv: "Ed25519" })).privateKey;
    const { x = "" } = await exportJWK(pair.publicKey);
    keys = { k1: x };
  });

  it("returns the claims and key id of a license signed by a known key", async () => {
    await expect(verifyLicense(await sign(claims), keys)).resolves.toEqual({ kid: "k1", claims });
  });

  it("refuses a signature by another key under a known key id", async () => {
    expect(await refusal(await sign(claims, {}, otherPrivateKey))).toBe("badSignature");
  });

  it("refuses a payload changed after signing", async () => {
    const [header, , signature] = (await sign(claims)).split(".");
    const forged = base64url.encode(
      JSON.stringify({ ...claims, limits: { ...claims.limits, users: 99 } }),
    );
    expect(await refusal(`${header}.${forged}.${signature}`)).toBe("badSignature");
  });

  it.each([
    ["an unknown key id", { kid: "k2" }],
    ["no key id", { kid: undefined }],
    ["a key id naming an inherited property", { kid: "constructor" }],
  ])("refuses %s", async (_, header) => {
    expect(await refusal(await sign(claims, header))).toBe("unknownKey");
  });

  it.each([
    ["another token type", { typ: "JWT" }, claims],
    ["claims with an unknown field", {}, { ...claims, device: "x" }],
    ["claims without a tenant", {}, { ...claims, tenant: undefined }],
    ["an expiry before validity", {}, { ...claims, expiresAt: claims.notBefore }],
    ["a local-time instant", {}, { ...claims, expiresAt: "2027-09-25T11:00:00.000+03:00" }],
    ["a negative day count", {}, { ...claims, graceDays: -1 }],
    ["zero users", {}, { ...claims, limits: { ...claims.limits, users: 0 } }],
  ])("refuses %s as malformed", async (_, header, payload) => {
    expect(await refusal(await sign(payload, header))).toBe("malformed");
  });

  it("refuses other algorithms and text that is not a JWS", async () => {
    const hs256 = new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256", typ: "mustawfi-license", kid: "k1" })
      .sign(new Uint8Array(32));
    expect(await refusal(await hs256)).toBe("malformed");
    expect(await refusal("not a license")).toBe("malformed");
    expect(await refusal("")).toBe("malformed");
  });
});

describe("licensePublicKeysSchema", () => {
  const x = "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo";

  it("reads kid:key pairs separated by commas", () => {
    expect(licensePublicKeysSchema.parse(` k1:${x}, 2026-2:${x} `)).toEqual({
      k1: x,
      "2026-2": x,
    });
  });

  it.each([
    ["nothing", ""],
    ["a key without a kid", `:${x}`],
    ["a kid without a key", "k1"],
    ["a short key", "k1:abc"],
    ["a duplicate kid", `k1:${x},k1:${x}`],
    ["a kid with spaces", `k 1:${x}`],
  ])("refuses %s", (_, text) => {
    expect(licensePublicKeysSchema.safeParse(text).success).toBe(false);
  });
});

describe("licenseState", () => {
  const at = (iso: string) => new Date(iso);

  it("walks the states at their boundaries, each boundary belonging to the later state", () => {
    const terms: LicenseTerms = {
      expiresAt: "2027-01-31T00:00:00.000Z",
      graceDays: 7,
      readOnlyDays: 30,
    };
    expect(licenseState(terms, at("2027-01-16T23:59:59.999Z"))).toBe("active");
    expect(licenseState(terms, at("2027-01-17T00:00:00.000Z"))).toBe("expiring");
    expect(licenseState(terms, at("2027-01-30T23:59:59.999Z"))).toBe("expiring");
    expect(licenseState(terms, at("2027-01-31T00:00:00.000Z"))).toBe("grace");
    expect(licenseState(terms, at("2027-02-06T23:59:59.999Z"))).toBe("grace");
    expect(licenseState(terms, at("2027-02-07T00:00:00.000Z"))).toBe("readOnly");
    expect(licenseState(terms, at("2027-03-08T23:59:59.999Z"))).toBe("readOnly");
    expect(licenseState(terms, at("2027-03-09T00:00:00.000Z"))).toBe("suspended");
  });

  it("refuses an invalid instant", () => {
    expect(() => licenseState(claims, new Date(Number.NaN))).toThrow(RangeError);
  });

  const expiry = fc
    .date({
      min: new Date("2026-01-01T00:00:00Z"),
      max: new Date("2040-01-01T00:00:00Z"),
      noInvalidDate: true,
    })
    .map((date) => date.toISOString());
  const terms = fc.record({
    expiresAt: expiry,
    graceDays: fc.integer({ min: 0, max: 60 }),
    readOnlyDays: fc.integer({ min: 0, max: 120 }),
  });
  /** An instant within two years of the expiry. */
  const offset = fc.integer({ min: -730 * DAY, max: 730 * DAY });
  const rank = (state: string) => LICENSE_STATES.indexOf(state as (typeof LICENSE_STATES)[number]);

  test.prop([terms, offset, offset])("never moves backwards in time", (t, a, b) => {
    const expiresAt = Date.parse(t.expiresAt);
    const [earlier, later] = a <= b ? [a, b] : [b, a];
    expect(rank(licenseState(t, new Date(expiresAt + earlier)))).toBeLessThanOrEqual(
      rank(licenseState(t, new Date(expiresAt + later))),
    );
  });

  test.prop([terms])("changes state exactly at each boundary and at no other day count", (t) => {
    const expiresAt = Date.parse(t.expiresAt);
    const starts = licenseStateStarts(t);
    expect(starts.expiring).toBe(expiresAt - EXPIRING_DAYS * DAY);
    expect(starts.grace).toBe(expiresAt);
    expect(starts.readOnly).toBe(expiresAt + t.graceDays * DAY);
    expect(starts.suspended).toBe(expiresAt + (t.graceDays + t.readOnlyDays) * DAY);

    for (const state of LICENSE_STATES.slice(1)) {
      const start = starts[state];
      // At its start a state (or a later one sharing the instant, when days are zero) holds;
      // one millisecond earlier an earlier state holds.
      const atStart = licenseState(t, new Date(start));
      expect(rank(atStart)).toBeGreaterThanOrEqual(rank(state));
      expect(rank(licenseState(t, new Date(start - 1)))).toBeLessThan(rank(state));
    }
    expect(licenseState(t, new Date(starts.suspended))).toBe("suspended");
    expect(licenseState(t, new Date(starts.expiring - 1))).toBe("active");
  });

  test.prop([terms])("skips grace and read-only when their days are zero", (t) => {
    const expiresAt = new Date(t.expiresAt);
    const state = licenseState(t, expiresAt);
    if (t.graceDays > 0) expect(state).toBe("grace");
    else if (t.readOnlyDays > 0) expect(state).toBe("readOnly");
    else expect(state).toBe("suspended");
  });
});

describe("the business day (core-foundation rule 6)", () => {
  it("turns at midnight in Damascus, three hours ahead of UTC", () => {
    expect(businessDate(new Date("2026-10-27T20:59:59.999Z"))).toBe("2026-10-27");
    expect(businessDate(new Date("2026-10-27T21:00:00.000Z"))).toBe("2026-10-28");
  });

  it("refuses an invalid instant", () => {
    expect(() => businessDate(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("readOnlyBusinessDate (core-foundation rule 5)", () => {
  it("is the Damascus date of the instant the grace days end", () => {
    const terms: LicenseTerms = {
      expiresAt: "2026-10-20T20:30:00.000Z",
      graceDays: 7,
      readOnlyDays: 30,
    };
    // Read-only from 2026-10-27T20:30Z, which is 23:30 on the 27th in Damascus.
    expect(readOnlyBusinessDate(terms)).toBe("2026-10-27");
    expect(readOnlyBusinessDate({ ...terms, expiresAt: "2026-10-20T21:00:00.000Z" })).toBe(
      "2026-10-28",
    );
  });

  test.prop([
    fc.date({
      min: new Date("2026-01-01T00:00:00.000Z"),
      max: new Date("2030-01-01T00:00:00.000Z"),
      noInvalidDate: true,
    }),
    fc.integer({ min: 0, max: 60 }),
    fc.integer({ min: 0, max: 60 }),
  ])("is the business date of the first instant the state is read-only", (expires, grace, days) => {
    const terms: LicenseTerms = {
      expiresAt: expires.toISOString(),
      graceDays: grace,
      readOnlyDays: days,
    };
    const start = licenseStateStarts(terms).readOnly;
    expect(isReadOnlyState(licenseState(terms, new Date(start)))).toBe(true);
    expect(isReadOnlyState(licenseState(terms, new Date(start - 1)))).toBe(false);
    expect(readOnlyBusinessDate(terms)).toBe(businessDate(new Date(start)));
  });
});
