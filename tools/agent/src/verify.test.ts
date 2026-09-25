import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scriptsInChain, verify, verifySteps } from "./verify.ts";

const rootDir = resolve(import.meta.dirname, "../../..");
const rootPackage = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

/** A step whose command prints `lines` and exits with `code`. */
function nodeStep(script: string, lines: string[], code: number) {
  const body = `${lines.map((l) => `console.log(${JSON.stringify(l)});`).join("")}process.exit(${code});`;
  return { script, command: `node -e ${JSON.stringify(body)}` };
}

let workspace: string | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  workspace = undefined;
});

describe("verify steps", () => {
  it("match the root verify script, in order", () => {
    const chain = rootPackage.scripts["verify"];
    expect(chain).toBeDefined();
    expect(verifySteps.map((s) => s.script)).toEqual(scriptsInChain(chain ?? ""));
  });

  it("run the root script for every step except the reporter-quieted test run", () => {
    for (const step of verifySteps.filter((s) => s.script !== "test")) {
      expect(step.command).toBe(`pnpm run ${step.script}`);
    }
    expect(rootPackage.scripts["test"]).toBe("vitest run");
    expect(verifySteps.find((s) => s.script === "test")?.command).toBe(
      "pnpm exec vitest run --reporter=minimal",
    );
  });

  it("refuses a chain part it does not understand", () => {
    expect(() => scriptsInChain("pnpm build && rm -rf dist")).toThrow(/Unexpected verify step/);
  });
});

describe("verify", () => {
  it("prints one line per passing step and a condensed failure, then stops", async () => {
    workspace = mkdtempSync(join(tmpdir(), "mustawfi-verify-"));
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => printed.push(line));
    const noise = Array.from({ length: 80 }, (_, i) => `ok ${i}`);

    const code = await verify(workspace, [
      nodeStep("build", noise, 0),
      nodeStep("lint", [...noise, "error  Unexpected any  no-explicit-any"], 1),
      nodeStep("test", ["never runs"], 0),
    ]);

    const output = printed.join("\n");
    expect(code).toBe(1);
    expect(output).toMatch(/^✔ build \(/m);
    expect(output).toMatch(/^✖ lint failed \(exit 1,/m);
    expect(output).toContain("error  Unexpected any  no-explicit-any");
    expect(output).not.toContain("ok 5\n");
    expect(output).not.toContain("never runs");
    expect(output).toContain("verify: FAILED at lint");
    const log = readFileSync(
      join(workspace, "node_modules/.cache/mustawfi-verify/lint.log"),
      "utf8",
    );
    expect(log).toContain("ok 5\n");
  });

  it("reports success when every step passes", async () => {
    workspace = mkdtempSync(join(tmpdir(), "mustawfi-verify-"));
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => printed.push(line));

    expect(await verify(workspace, [nodeStep("build", ["done"], 0)])).toBe(0);
    expect(printed.at(-1)).toBe("verify: PASSED");
  });
});
