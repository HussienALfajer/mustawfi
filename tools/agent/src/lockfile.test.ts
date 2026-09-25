import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const lockfile = readFileSync(new URL("../../../pnpm-lock.yaml", import.meta.url), "utf8");

/** The resolved version (with peer suffix) of `name` for each workspace importer. */
function importerVersions(name: string): Map<string, string> {
  const importers = lockfile.slice(
    lockfile.lastIndexOf("\nimporters:"),
    lockfile.lastIndexOf("\npackages:"),
  );
  const versions = new Map<string, string>();
  let importer = "";
  const lines = importers.split("\n");
  lines.forEach((line, i) => {
    const heading = /^ {2}(\S.*):$/.exec(line);
    if (heading?.[1] !== undefined) importer = heading[1];
    if (line === `      ${name}:`) {
      const version = /^ {8}version: (.+)$/.exec(lines[i + 2] ?? "")?.[1];
      if (version !== undefined) versions.set(importer, version);
    }
  });
  return versions;
}

describe("pnpm lockfile", () => {
  // Optional peers (vite's esbuild, tsx, yaml) can split Vitest into several installs; test
  // files and @fast-check/vitest then bind to a different copy than the runner and fail with
  // "Vitest failed to find the current suite". `pnpm dedupe` merges them.
  it("resolves Vitest to one install across the workspace", () => {
    const versions = importerVersions("vitest");
    expect(versions.size).toBeGreaterThan(1);
    expect(new Set(versions.values()).size, "run `pnpm dedupe`").toBe(1);
  });
});
