import { describe, expect, it } from "vitest";
import { condense, stripAnsi } from "./condense.ts";

const passingNoise = Array.from(
  { length: 200 },
  (_, i) => ` ✓ src/case-${i}.test.ts > passes ${i}`,
);

describe("condense", () => {
  it("drops passing noise and keeps the failure and the summary", () => {
    const output = [
      ...passingNoise.slice(0, 100),
      " FAIL  src/ledger.test.ts > refuses an unbalanced entry",
      "AssertionError: expected 'posted' to be 'refused'",
      "  at src/ledger.test.ts:42:7",
      ...passingNoise.slice(100),
      " Test Files  1 failed | 40 passed (41)",
      "      Tests  1 failed | 199 passed (200)",
    ].join("\n");

    const result = condense(output, { tailLines: 2 });

    expect(result).toContain("FAIL  src/ledger.test.ts > refuses an unbalanced entry");
    expect(result).toContain("AssertionError: expected 'posted' to be 'refused'");
    expect(result).toContain("src/ledger.test.ts:42:7");
    expect(result).toContain("Tests  1 failed | 199 passed (200)");
    expect(result).not.toContain("passes 50");
    expect(result.split("\n").length).toBeLessThan(20);
  });

  it("marks omitted stretches so a reader knows lines are missing", () => {
    const result = condense([...passingNoise, "error TS2322: bad type"].join("\n"), {
      tailLines: 1,
    });
    expect(result).toMatch(/… 200 line\(s\) omitted/);
  });

  it("caps the output while keeping the first signal and the tail", () => {
    const errors = Array.from({ length: 500 }, (_, i) => `error ${i}`);
    const lines = condense(errors.join("\n"), {
      maxLines: 30,
      contextAfter: 0,
      tailLines: 5,
    }).split("\n");
    expect(lines.filter((line) => line.startsWith("error")).length).toBe(30);
    expect(lines[0]).toBe("error 0");
    expect(lines.at(-1)).toBe("error 499");
  });

  it("strips colour codes and Windows line endings", () => {
    expect(stripAnsi("\u001b[31mFAIL\u001b[39m")).toBe("FAIL");
    expect(condense("one\r\ntwo\r\n")).toBe("one\ntwo");
  });
});
