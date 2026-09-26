import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSecret, parseTotpKeys, sealSecret } from "@mustawfi/core-access/server";
import { cryptoRandom } from "@mustawfi/kernel";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { totpKeyCommand } from "./totp-key.ts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mustawfi-totp-key-"));
  file = join(dir, "totp.keys");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function run(...argv: string[]) {
  let stdout = "";
  let stderr = "";
  const code = await totpKeyCommand({
    argv,
    env: {},
    stdout: { write: (text: string) => (stdout += text) },
    stderr: { write: (text: string) => (stderr += text) },
  });
  return { code, stdout, stderr };
}

const CONTEXT = "core_access.users.totp_secret:tenant:user";

describe("access:totp-key (core-foundation slice 10)", () => {
  it("writes a new key file the server reads, owner-only, printing no key", async () => {
    const result = await run("--kid", "k1", "--out", file);
    expect(result.code).toBe(0);
    const text = readFileSync(file, "utf8");
    const ring = parseTotpKeys(text);
    expect(ring.current).toBe("k1");
    const key = text.trim().split(":")[1] ?? "";
    expect(result.stdout + result.stderr).not.toContain(key);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("never overwrites a key file", async () => {
    writeFileSync(file, "k0:existing\n");
    const result = await run("--kid", "k1", "--out", file);
    expect(result.code).toBe(1);
    expect(readFileSync(file, "utf8")).toBe("k0:existing\n");
  });

  it("rotates: the new key seals, the old one still opens what it sealed", async () => {
    expect((await run("--kid", "k1", "--out", file)).code).toBe(0);
    const sealed = sealSecret(
      parseTotpKeys(readFileSync(file, "utf8")),
      new Uint8Array([1, 2, 3]),
      CONTEXT,
      cryptoRandom,
    );
    const rotated = await run("--kid", "k2", "--out", file, "--rotate");
    expect(rotated.code).toBe(0);
    expect(rotated.stderr).toContain("k2 now seals new secrets; k1 still open theirs");
    const ring = parseTotpKeys(readFileSync(file, "utf8"));
    expect([...ring.keys.keys()]).toEqual(["k2", "k1"]);
    expect(openSecret(ring, sealed, CONTEXT)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("refuses a rotation to a key id already in the file, of a missing or broken file", async () => {
    expect((await run("--kid", "k1", "--out", file)).code).toBe(0);
    const before = readFileSync(file, "utf8");
    expect((await run("--kid", "k1", "--out", file, "--rotate")).code).toBe(1);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect((await run("--kid", "k2", "--out", join(dir, "none"), "--rotate")).code).toBe(1);
    writeFileSync(join(dir, "broken"), "not a key file\n");
    const broken = await run("--kid", "k2", "--out", join(dir, "broken"), "--rotate");
    expect(broken.code).toBe(1);
    expect(broken.stderr).toContain("line 1");
  });

  it.each([
    ["no key id", ["--out", "x"]],
    ["no file", ["--kid", "k1"]],
    ["a key id with a space", ["--kid", "k 1", "--out", "x"]],
    ["an unknown option", ["--kid", "k1", "--out", "x", "--force"]],
  ])("refuses %s as bad usage", async (_, argv) => {
    expect((await run(...argv)).code).toBe(2);
  });
});
