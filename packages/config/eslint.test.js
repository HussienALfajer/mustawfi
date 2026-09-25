import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import { mustawfi, sharedEntryRules } from "./eslint.js";

const linter = new Linter({ configType: "flat" });
const config = [{ files: ["**/*.js"] }, sharedEntryRules];

/**
 * @param {string} code
 * @param {string} filename
 */
function restrictedGlobals(code, filename) {
  return linter
    .verify(code, config, { filename })
    .filter((m) => m.ruleId === "no-restricted-globals")
    .map((m) => m.message.split(" ")[0]);
}

describe("shared entry lint rules (ADR-0015 rule 3)", () => {
  it("rejects browser and Node globals in shared code", () => {
    const code = "window.alert(1);\nprocess.exit(0);\ndocument.title;\n";
    expect(restrictedGlobals(code, "core/ledger/src/shared/a.js")).toHaveLength(3);
    expect(restrictedGlobals(code, "modules/sales/src/shared/a.js")).toHaveLength(3);
  });

  it("allows language globals in shared code and platform globals elsewhere", () => {
    expect(
      restrictedGlobals("Math.max(1, 2); new Map();\n", "core/ledger/src/shared/a.js"),
    ).toEqual([]);
    expect(restrictedGlobals("window.alert(1);\n", "core/ledger/src/client/a.js")).toEqual([]);
  });

  it("is part of the project config", () => {
    expect(mustawfi({ tsconfigRootDir: import.meta.dirname })).toContainEqual(sharedEntryRules);
  });
});
