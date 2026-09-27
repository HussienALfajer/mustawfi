import { glob, readFile } from "node:fs/promises";
import { dirname, join, matchesGlob, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_SRC = import.meta.dirname;
const ROOT = resolve(WEB_SRC, "../../..");

/** `@source` paths of the app's stylesheet, as globs relative to the repository root. */
async function sourceGlobs(): Promise<string[]> {
  const css = await readFile(join(WEB_SRC, "styles.css"), "utf8");
  return [...css.matchAll(/^@source\s+"([^"]+)";/gm)].map((match) => {
    const path = relative(ROOT, resolve(WEB_SRC, match[1] ?? "")).replaceAll("\\", "/");
    // A directory source covers everything below it.
    return path.includes("*") ? path : `${path}/**`;
  });
}

describe("Tailwind sources", () => {
  it("cover every workspace component that styles with classes", async () => {
    const globs = await sourceGlobs();
    const uncovered: string[] = [];
    for await (const file of glob(
      ["packages/*/src/**/*.tsx", "core/*/src/**/*.tsx", "modules/*/src/**/*.tsx"],
      {
        cwd: ROOT,
        exclude: (name) => name === "node_modules",
      },
    )) {
      const path = file.replaceAll("\\", "/");
      if (path.endsWith(".test.tsx")) continue;
      if (!(await readFile(join(ROOT, path), "utf8")).includes("className")) continue;
      if (!globs.some((pattern) => matchesGlob(path, pattern))) uncovered.push(dirname(path));
    }
    // Tailwind scans the app itself; workspace packages arrive through node_modules and are
    // skipped unless listed, so their classes silently generate no CSS (the gallery's swatches).
    expect([...new Set(uncovered)]).toEqual([]);
  });
});
