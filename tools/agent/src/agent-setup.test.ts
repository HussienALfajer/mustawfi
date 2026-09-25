import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Keeps the checked-in agent setup (.claude/) pointing at things that exist.
const rootDir = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(join(rootDir, path), "utf8");

const adrNumbers = new Set(
  readdirSync(join(rootDir, "docs/decisions"))
    .map((name) => /^(\d{4})-/.exec(name)?.[1])
    .filter((n): n is string => n !== undefined),
);

describe("path-scoped rules", () => {
  const required = ["ledger", "sync", "tenancy", "migrations", "rtl-ui"];

  it.each(required)("%s exists, is scoped by paths, and cites only existing ADRs", (name) => {
    const text = read(`.claude/rules/${name}.md`);
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text.replace(/\r\n/g, "\n"))?.[1] ?? "";
    expect(frontmatter).toMatch(/^paths:\n( {2}- "[^"]+"\n?)+$/);

    const cited = [...text.matchAll(/ADR-(\d{4})/g)].map((m) => m[1]);
    expect(cited.length).toBeGreaterThan(0);
    for (const n of cited) expect(adrNumbers, `ADR-${n}`).toContain(n);
  });
});

describe("hooks", () => {
  it("run scripts that exist in the repository", () => {
    const settings = JSON.parse(read(".claude/settings.json")) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    const commands = Object.values(settings.hooks)
      .flat()
      .flatMap((entry) => entry.hooks.map((h) => h.command));
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      const script = /\$CLAUDE_PROJECT_DIR\/([^"]+)"/.exec(command)?.[1];
      expect(script, command).toBeDefined();
      expect(existsSync(join(rootDir, script ?? "")), script).toBe(true);
    }
  });

  it("format files after every edit", () => {
    const settings = JSON.parse(read(".claude/settings.json")) as {
      hooks: { PostToolUse?: { matcher: string; hooks: { command: string }[] }[] };
    };
    const formatter = settings.hooks.PostToolUse?.find((e) =>
      e.hooks.some((h) => h.command.includes("format-edited-hook.ts")),
    );
    expect(formatter?.matcher.split("|")).toEqual(expect.arrayContaining(["Edit", "Write"]));
  });
});

describe("verify skill", () => {
  it("runs root scripts that exist", () => {
    const skill = read(".claude/skills/verify/SKILL.md");
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> })
      .scripts;
    const used = [...skill.matchAll(/`pnpm ([\w:]+)/g)].map((m) => m[1] ?? "");
    expect(used).toContain("verify:agent");
    for (const name of used) expect(scripts, name).toHaveProperty([name]);
  });
});
