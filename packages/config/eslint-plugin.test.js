import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { domainRules, mustawfi } from "./eslint.js";

const linter = new Linter({ configType: "flat" });
/** @type {import("eslint").Linter.Config[]} */
const config = [
  // Parse the fixtures as TypeScript, as the real domain code is.
  { files: ["**/*.ts"], languageOptions: { parser: /** @type {any} */ (tseslint.parser) } },
  ...domainRules,
];

/**
 * The project-rule findings for `code` linted as `filename`, as `rule: text` pairs.
 * @param {string} code
 * @param {string} filename
 */
function findings(code, filename) {
  const messages = linter.verify(code, config, { filename });
  const fatal = messages.find((m) => m.fatal);
  if (fatal) throw new Error(`Fixture does not parse: ${fatal.message}`);
  return messages
    .filter((m) => m.ruleId?.startsWith("mustawfi/"))
    .map((m) => `${m.ruleId?.replace("mustawfi/", "") ?? ""}: ${m.message.split(". ")[0] ?? ""}`);
}

const DOMAIN = "core/ledger/src/server/posting.ts";
const APP = "apps/web/src/main.ts";

describe("no-float-money (ADR-0018)", () => {
  const fixture = [
    `const a = parseFloat("1.5");`,
    `const b = Number("1.5");`,
    `const c = Number.parseFloat("1.5");`,
    `const d = globalThis.Number("2");`,
    `const e = new Number(3);`,
    `const f = (1.005).toFixed(2);`,
    `const g = price.toPrecision(4);`,
    `const h = Math.round(total * 100) / 100;`,
    `import Big from "decimal.js";`,
    `declare const price: number; declare const total: number;`,
  ].join("\n");

  it("fires on every float-money construct in domain code", () => {
    expect(findings(fixture, DOMAIN)).toEqual([
      "no-float-money: `parseFloat` turns text into a float",
      "no-float-money: `Number` turns text into a float",
      "no-float-money: `Number.parseFloat` turns text into a float",
      "no-float-money: `Number` turns text into a float",
      "no-float-money: `new Number` turns text into a float",
      "no-float-money: `.toFixed()` rounds through a float",
      "no-float-money: `.toPrecision()` rounds through a float",
      "no-float-money: `Math.round` rounds a float with an unnamed mode",
      "no-float-money: Only @mustawfi/kernel wraps `decimal.js`; use its Decimal so rounding stays explicit (ADR-0018).",
    ]);
  });

  it("fires in every module entry and in the kernel", () => {
    for (const file of [
      "modules/sales/src/shared/totals.ts",
      "modules/sales/src/client/cart.ts",
      "core/currency/src/server/rates.ts",
      "packages/kernel/src/money.ts",
    ]) {
      expect(findings(`const x = parseFloat("1");`, file)).toHaveLength(1);
    }
  });

  it("leaves integer helpers, shadowed names, and non-domain code alone", () => {
    const allowed = [
      `const a = Number.isSafeInteger(3);`,
      `const b = Number.parseInt("12", 10);`,
      `const c = BigInt("12");`,
      `const d = Math.max(1, 2);`,
      `function f(Number: (x: string) => string) { return Number("1"); }`,
    ].join("\n");
    expect(findings(allowed, DOMAIN)).toEqual([]);
    expect(findings(fixture, APP)).toEqual([]);
  });

  it("lets only the kernel's Decimal import the decimal library", () => {
    const code = `import Big from "decimal.js";`;
    expect(findings(code, "packages/kernel/src/decimal.ts")).toEqual([]);
    expect(findings(code, "packages/kernel/src/money.ts")).toHaveLength(1);
    expect(findings(`const f = (1).toFixed(2);`, "packages/kernel/src/decimal.ts")).toHaveLength(1);
  });
});

describe("no-ambient-clock (ADR-0015 rule 6)", () => {
  const fixture = [
    `const a = Date.now();`,
    `const b = new Date();`,
    `const c = Date();`,
    `const d = globalThis.Date.now();`,
    `const e = performance.now();`,
    `const f = [1].map(Date.now);`,
  ].join("\n");

  it("fires on every ambient clock read in domain code", () => {
    expect(findings(fixture, DOMAIN)).toEqual([
      "no-ambient-clock: `Date.now` reads the ambient clock",
      "no-ambient-clock: `new Date()` reads the ambient clock",
      "no-ambient-clock: `Date()` reads the ambient clock",
      "no-ambient-clock: `Date.now` reads the ambient clock",
      "no-ambient-clock: `performance.now` reads the ambient clock",
      "no-ambient-clock: `Date.now` reads the ambient clock",
    ]);
  });

  it("allows dates built from a value, a local `Date`, and non-domain code", () => {
    const allowed = [
      `const a = new Date("2026-09-25T00:00:00Z");`,
      `const b = new Date(clock.now().getTime());`,
      `const c = Date.UTC(2026, 8, 25);`,
      `declare const clock: { now(): Date };`,
    ].join("\n");
    expect(findings(allowed, DOMAIN)).toEqual([]);
    expect(findings(`class Date { static now() { return 0; } }\nDate.now();`, DOMAIN)).toEqual([]);
    expect(findings(fixture, APP)).toEqual([]);
  });

  it("exempts only the kernel's Clock", () => {
    expect(findings(`const a = new Date();`, "packages/kernel/src/clock.ts")).toEqual([]);
    expect(findings(`const a = new Date();`, "packages/kernel/src/id.ts")).toHaveLength(1);
    expect(findings(`const a = Math.random();`, "packages/kernel/src/clock.ts")).toHaveLength(1);
  });
});

describe("no-ambient-randomness (ADR-0015 rule 6)", () => {
  const fixture = [
    `const a = Math.random();`,
    `const b = crypto.randomUUID();`,
    `const c = crypto.getRandomValues(new Uint8Array(4));`,
    `const d = globalThis.crypto.randomUUID();`,
    `import { randomBytes, createHash } from "node:crypto";`,
    `import { randomUUID } from "crypto";`,
  ].join("\n");

  it("fires on every ambient randomness source in domain code", () => {
    expect(findings(fixture, DOMAIN)).toEqual([
      "no-ambient-randomness: `Math.random` is ambient randomness",
      "no-ambient-randomness: `crypto.randomUUID` is ambient randomness",
      "no-ambient-randomness: `crypto.getRandomValues` is ambient randomness",
      "no-ambient-randomness: `crypto.randomUUID` is ambient randomness",
      "no-ambient-randomness: `node:crypto.randomBytes` is ambient randomness",
      "no-ambient-randomness: `crypto.randomUUID` is ambient randomness",
    ]);
  });

  it("allows hashing, injected sources, and non-domain code", () => {
    const allowed = [
      `import { createHash } from "node:crypto";`,
      `const h = createHash("sha256");`,
      `const b = random.bytes(16);`,
      `declare const random: { bytes(n: number): Uint8Array };`,
    ].join("\n");
    expect(findings(allowed, DOMAIN)).toEqual([]);
    expect(findings(fixture, APP)).toEqual([]);
  });

  it("exempts only the kernel's RandomSource", () => {
    const code = `const a = crypto.getRandomValues(new Uint8Array(4));`;
    expect(findings(code, "packages/kernel/src/random.ts")).toEqual([]);
    expect(findings(code, "packages/kernel/src/id.ts")).toHaveLength(1);
  });
});

it("the project config includes the domain rules", () => {
  const project = mustawfi({ tsconfigRootDir: import.meta.dirname });
  for (const entry of domainRules) expect(project).toContainEqual(entry);
});
