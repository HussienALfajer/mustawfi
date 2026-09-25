import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { licensePublicKeysSchema, verifyLicense } from "@mustawfi/core-tenancy/shared";
import { manualClock } from "@mustawfi/kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLANS } from "../plans.ts";
import { issueCommand } from "./issue.ts";
import { keygenCommand } from "./keygen.ts";

let dir: string;
let keyFile: string;
let publicKeys: Record<string, string>;
const clock = manualClock(new Date("2026-09-25T09:00:00.000Z"));

function io(argv: string[]) {
  const out = { stdout: "", stderr: "" };
  return {
    out,
    io: {
      argv,
      stdout: { write: (text: string) => (out.stdout += text) },
      stderr: { write: (text: string) => (out.stderr += text) },
    },
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "license-cli-"));
  keyFile = join(dir, "license-2026-1.jwk");
  const run = io(["--kid", "2026-1", "--out", keyFile]);
  expect(await keygenCommand(run.io)).toBe(0);
  publicKeys = licensePublicKeysSchema.parse(run.out.stdout.trim());
});

afterAll(() => rm(dir, { recursive: true, force: true }));

describe("license:keygen", () => {
  it("writes a private JWK and prints the matching public key entry", async () => {
    const jwk = JSON.parse(await readFile(keyFile, "utf8")) as Record<string, string>;
    expect(jwk).toMatchObject({ kty: "OKP", crv: "Ed25519", kid: "2026-1" });
    expect(publicKeys).toEqual({ "2026-1": jwk["x"] });
    if (process.platform !== "win32") expect((await stat(keyFile)).mode & 0o777).toBe(0o600);
  });

  it("never overwrites an existing key", async () => {
    const before = await readFile(keyFile, "utf8");
    const run = io(["--kid", "2026-2", "--out", keyFile]);
    expect(await keygenCommand(run.io)).toBe(1);
    expect(await readFile(keyFile, "utf8")).toBe(before);
  });

  it.each([[["--out", "x.jwk"]], [["--kid", "a b", "--out", "y.jwk"]], [["--kid", "k"]]])(
    "refuses bad usage %j",
    async (argv) => {
      expect(await keygenCommand(io(argv).io)).toBe(2);
    },
  );
});

describe("license:issue", () => {
  async function issue(argv: string[]) {
    const run = io(["--key", keyFile, ...argv]);
    const code = await issueCommand(run.io, clock);
    return { code, ...run.out };
  }

  it("issues a license for a new tenant with the plan's values and the defaults", async () => {
    const result = await issue(["--tenant", "new", "--plan", "phonesPro"]);
    expect(result.code).toBe(0);
    const { kid, claims } = await verifyLicense(result.stdout.trim(), publicKeys);
    expect(kid).toBe("2026-1");
    expect(claims).toEqual({
      tenant: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      plan: "phonesPro",
      issuedAt: "2026-09-25T09:00:00.000Z",
      notBefore: "2026-09-25T09:00:00.000Z",
      expiresAt: "2027-09-25T09:00:00.000Z",
      graceDays: 7,
      readOnlyDays: 30,
      maxOfflineDays: 10,
      limits: PLANS.phonesPro.limits,
      entitlements: [...PLANS.phonesPro.entitlements],
    });
    expect(result.stderr).toContain(claims.tenant);
  });

  it("takes a tenant id, dates with offsets, day counts, and limit overrides", async () => {
    const tenant = "0199a0b4-7c3e-7000-8000-00000000abcd";
    const result = await issue([
      "--tenant",
      tenant,
      "--plan",
      "basic",
      "--not-before",
      "2026-10-01T00:00:00+03:00",
      "--expires",
      "2026-11-01T00:00:00+03:00",
      "--limit",
      "users=8",
      "--limit",
      "companionDevices=0",
      "--grace-days",
      "0",
      "--read-only-days",
      "14",
      "--max-offline-days",
      "5",
    ]);
    expect(result.code).toBe(0);
    const { claims } = await verifyLicense(result.stdout.trim(), publicKeys);
    expect(claims).toMatchObject({
      tenant,
      plan: "basic",
      notBefore: "2026-09-30T21:00:00.000Z",
      expiresAt: "2026-10-31T21:00:00.000Z",
      graceDays: 0,
      readOnlyDays: 14,
      maxOfflineDays: 5,
      limits: { users: 8, departments: 2, mainPosDevices: 1, companionDevices: 0 },
    });
  });

  it.each([
    ["an unknown plan", ["--tenant", "new", "--plan", "gold"]],
    ["a missing tenant", ["--plan", "basic"]],
    ["a tenant that is not an id", ["--tenant", "store", "--plan", "basic"]],
    [
      "an instant without an offset",
      ["--tenant", "new", "--plan", "basic", "--expires", "2027-01-01T00:00:00"],
    ],
    ["an unknown limit", ["--tenant", "new", "--plan", "basic", "--limit", "branches=2"]],
    ["a malformed limit", ["--tenant", "new", "--plan", "basic", "--limit", "users"]],
    [
      "an inherited name as a limit",
      ["--tenant", "new", "--plan", "basic", "--limit", "constructor=5"],
    ],
    ["negative days", ["--tenant", "new", "--plan", "basic", "--grace-days", "-1"]],
    ["empty days", ["--tenant", "new", "--plan", "basic", "--grace-days", ""]],
    ["an unknown flag", ["--tenant", "new", "--plan", "basic", "--device", "x"]],
  ])("refuses %s as bad usage", async (_, argv) => {
    const result = await issue(argv);
    expect(result).toMatchObject({ code: 2, stdout: "" });
    expect(result.stderr).toContain("usage:");
  });

  it("refuses a license that would expire before it is valid, and a missing key file", async () => {
    const early = await issue([
      "--tenant",
      "new",
      "--plan",
      "basic",
      "--expires",
      "2026-01-01T00:00:00Z",
    ]);
    expect(early).toMatchObject({ code: 1, stdout: "" });
    const run = io(["--key", join(dir, "missing.jwk"), "--tenant", "new", "--plan", "basic"]);
    expect(await issueCommand(run.io, clock)).toBe(1);
    expect(run.out.stdout).toBe("");
  });
});
