import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { domainRules, mustawfi, uiRules } from "./eslint.js";

const linter = new Linter({ configType: "flat" });
/** @type {import("eslint").Linter.Config[]} */
const config = [
  // Parse the fixtures as TypeScript, as the real domain code is.
  { files: ["**/*.ts"], languageOptions: { parser: /** @type {any} */ (tseslint.parser) } },
  {
    files: ["**/*.tsx"],
    languageOptions: {
      parser: /** @type {any} */ (tseslint.parser),
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  ...domainRules,
  uiRules,
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

describe("no-physical-direction (ADR-0024)", () => {
  const fixture = [
    'const a = <div className="ml-2 pr-4 text-left" />;',
    'const b = <div className={`hover:mr-1 ${x ? "left-0" : "right-2"}`} />;',
    'const c = <div className="-ml-px md:border-l rounded-tr-md float-right !pl-3" />;',
    'const d = <div style={{ marginLeft: 4, paddingRight: 2, left: 0, textAlign: "right" }} />;',
    'const e = cn("scroll-ml-2", "border-r-2");',
    "declare const x: boolean; declare function cn(...c: string[]): string;",
  ].join("\n");

  it("fires on physical utilities and style properties in interface code", () => {
    expect(findings(fixture, "apps/web/src/shell.tsx")).toEqual([
      "no-physical-direction: `ml-2` names a physical side",
      "no-physical-direction: `pr-4` names a physical side",
      "no-physical-direction: `text-left` names a physical side",
      "no-physical-direction: `mr-1` names a physical side",
      "no-physical-direction: `left-0` names a physical side",
      "no-physical-direction: `right-2` names a physical side",
      "no-physical-direction: `-ml-px` names a physical side",
      "no-physical-direction: `border-l` names a physical side",
      "no-physical-direction: `rounded-tr-md` names a physical side",
      "no-physical-direction: `float-right` names a physical side",
      "no-physical-direction: `pl-3` names a physical side",
      "no-physical-direction: `marginLeft` names a physical side",
      "no-physical-direction: `paddingRight` names a physical side",
      "no-physical-direction: `left` names a physical side",
      "no-physical-direction: `right` names a physical side",
      "no-physical-direction: `scroll-ml-2` names a physical side",
      "no-physical-direction: `border-r-2` names a physical side",
    ]);
  });

  it("fires in module screens and design-system components", () => {
    for (const file of [
      "core/access/src/client/login-screen.tsx",
      "modules/inventory/src/client/products-screen.tsx",
      "packages/ui/src/components/button.tsx",
    ]) {
      expect(findings('const a = <b className="mr-2" />;', file), file).toHaveLength(1);
    }
  });

  it("allows logical utilities, symmetric ones, and data outside style", () => {
    const code = [
      'const a = <div className="ms-2 me-1 ps-3 pe-4 start-0 end-2 text-start text-end border-s rounded-e-md mx-2 px-1 inset-x-0" />;',
      'const b = <div style={{ marginInlineStart: 4, insetInlineEnd: 0, textAlign: "end" }} />;',
      "const c = { left: 1, right: 2 };",
      'import "./left-panel.css";',
    ].join("\n");
    expect(findings(code, "apps/web/src/shell.tsx")).toEqual([]);
  });

  it("leaves server code, tests, and the token generator alone", () => {
    const code = 'const a = "ml-2 text-left";';
    expect(findings(code, "core/access/src/server/routes.ts")).toEqual([]);
    expect(findings(code, "packages/ui/src/tokens/css.ts")).toEqual([]);
    expect(findings(code, "apps/web/src/shell.test.tsx")).toEqual([]);
  });
});

describe("no-literal-string (ADR-0023)", () => {
  const fixture = [
    "const a = <p>تسجيل الدخول</p>;",
    "const b = <p>Sign in</p>;",
    'const c = <p>{"حفظ"}</p>;',
    "const d = <p>{`مرحبًا ${name}`}</p>;",
    'const e = <input aria-label="بحث" placeholder="Search" title="x" />;',
    'const f = <Field label="الاسم" description={"وصف"} errorMessage="خطأ" />;',
    'const g = <img alt="logo" />;',
    "declare const name: string; declare function Field(p: object): null;",
  ].join("\n");

  it("fires on literal text in JSX and in user-facing attributes", () => {
    expect(findings(fixture, "modules/inventory/src/client/products-screen.tsx")).toEqual([
      'no-literal-string: Literal text "تسجيل الدخول" in JSX',
      'no-literal-string: Literal text "Sign in" in JSX',
      'no-literal-string: Literal text "حفظ" in JSX',
      'no-literal-string: Literal text "مرحبًا" in JSX',
      'no-literal-string: Literal `aria-label` text "بحث"',
      'no-literal-string: Literal `placeholder` text "Search"',
      'no-literal-string: Literal `title` text "x"',
      'no-literal-string: Literal `label` text "الاسم"',
      'no-literal-string: Literal `description` text "وصف"',
      'no-literal-string: Literal `errorMessage` text "خطأ"',
      'no-literal-string: Literal `alt` text "logo"',
    ]);
  });

  it("allows translated text, numbers, punctuation, and non-text attributes", () => {
    const code = [
      'const a = <p className="text-sm" data-testid="total" id="x">{t("login.title")}</p>;',
      'const b = <p>{count} · 12:30 — {"/"}</p>;',
      'const c = <input type="password" autoComplete="current-password" name="password" aria-label={t("x")} />;',
      "declare const count: number; declare function t(key: string): string;",
    ].join("\n");
    expect(findings(code, "apps/web/src/shell.tsx")).toEqual([]);
  });

  it("fires in every interface location and leaves tests alone", () => {
    const code = "const a = <p>نص</p>;";
    for (const file of [
      "apps/web/src/main.tsx",
      "packages/ui/src/components/data-table.tsx",
      "core/access/src/client/login-screen.tsx",
    ]) {
      expect(findings(code, file), file).toHaveLength(1);
    }
    expect(findings(code, "packages/ui/src/components/button.test.tsx")).toEqual([]);
  });
});

it("the project config includes the domain and interface rules", () => {
  const project = mustawfi({ tsconfigRootDir: import.meta.dirname });
  for (const entry of domainRules) expect(project).toContainEqual(entry);
  expect(project).toContainEqual(uiRules);
});
