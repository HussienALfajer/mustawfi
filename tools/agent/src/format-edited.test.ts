import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editedFile, formatFile } from "./format-edited.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mustawfi-format-"));
  writeFileSync(join(root, ".prettierrc.json"), JSON.stringify({ printWidth: 100 }));
  writeFileSync(join(root, ".prettierignore"), "*.md\n");
  writeFileSync(join(root, ".gitignore"), "dist/\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, content: string): string {
  const file = join(root, path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, content);
  return file;
}

describe("formatFile", () => {
  it("formats a supported file in place", async () => {
    const file = write("src/a.ts", "const  a={b:1}\n");
    expect(await formatFile(root, file)).toBe("formatted");
    expect(readFileSync(file, "utf8")).toBe("const a = { b: 1 };\n");
  });

  it("accepts a path relative to the repository root", async () => {
    write("src/b.ts", "let x=1\n");
    expect(await formatFile(root, "src/b.ts")).toBe("formatted");
  });

  it("leaves a formatted file alone", async () => {
    const file = write("src/c.ts", "export const c = 1;\n");
    expect(await formatFile(root, file)).toBe("unchanged");
  });

  it("respects .prettierignore (Markdown prose is formatted by hand)", async () => {
    const file = write("docs/note.md", "|a|b|\n|-|-|\n");
    expect(await formatFile(root, file)).toBe("skipped");
    expect(readFileSync(file, "utf8")).toBe("|a|b|\n|-|-|\n");
  });

  it("respects .gitignore, as the Prettier CLI does", async () => {
    const file = write("dist/out.js", "let  x=1\n");
    expect(await formatFile(root, file)).toBe("skipped");
  });

  it("skips files outside the repository, under node_modules, or of unknown type", async () => {
    const outside = mkdtempSync(join(tmpdir(), "mustawfi-outside-"));
    try {
      writeFileSync(join(outside, "x.ts"), "let  x=1\n");
      expect(await formatFile(root, join(outside, "x.ts"))).toBe("skipped");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
    expect(await formatFile(root, write("node_modules/p/i.ts", "let  x=1\n"))).toBe("skipped");
    expect(await formatFile(root, write("assets/receipt.bin", "\u0000\u0001"))).toBe("skipped");
  });

  it("throws on unparsable code instead of writing it", async () => {
    const file = write("src/broken.ts", "const = ;\n");
    await expect(formatFile(root, file)).rejects.toThrow();
    expect(readFileSync(file, "utf8")).toBe("const = ;\n");
  });
});

describe("editedFile", () => {
  it("reads the file path from an Edit or Write payload", () => {
    expect(editedFile({ tool_name: "Edit", tool_input: { file_path: "D:/r/a.ts" } })).toBe(
      "D:/r/a.ts",
    );
  });

  it("returns undefined when the payload has no file path", () => {
    expect(editedFile({ tool_name: "Bash", tool_input: { command: "ls" } })).toBeUndefined();
    expect(editedFile(null)).toBeUndefined();
  });
});
