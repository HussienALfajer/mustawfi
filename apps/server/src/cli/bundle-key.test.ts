import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBundleSigningKey } from "@mustawfi/core-config/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleKeyCommand } from "./bundle-key.ts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mustawfi-bundle-key-"));
  file = join(dir, "bundle.key");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function run(...argv: string[]) {
  let stdout = "";
  let stderr = "";
  const code = await bundleKeyCommand({
    argv,
    env: {},
    stdout: { write: (text: string) => (stdout += text) },
    stderr: { write: (text: string) => (stderr += text) },
  });
  return { code, stdout, stderr };
}

describe("bundle:keygen (core-foundation slice 11)", () => {
  it("writes a key file the server reads, owner-only, and prints only its public entry", async () => {
    const result = await run("--kid", "bundle-2026", "--out", file);
    expect(result.code).toBe(0);
    const text = readFileSync(file, "utf8");
    const key = await parseBundleSigningKey(text);
    expect(key.kid).toBe("bundle-2026");
    expect(result.stdout).toBe(`${key.publicKey}\n`);
    const { d } = JSON.parse(text) as { d: string };
    expect(result.stdout + result.stderr).not.toContain(d);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("never overwrites a key file", async () => {
    writeFileSync(file, "existing\n");
    expect((await run("--kid", "bundle-2026", "--out", file)).code).toBe(1);
    expect(readFileSync(file, "utf8")).toBe("existing\n");
  });

  it("refuses a malformed key id or a missing output file", async () => {
    expect((await run("--kid", "no spaces", "--out", file)).code).toBe(2);
    expect((await run("--kid", "bundle-2026")).code).toBe(2);
  });
});
