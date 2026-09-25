import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import { plugin } from "./eslint-plugin.js";

/**
 * Browser and Node globals that code under a module's `src/shared/` must not touch:
 * shared code runs on the server and on offline clients alike (ADR-0015, rule 3).
 */
const platformGlobals = [
  ...new Set([...Object.keys(globals.browser), ...Object.keys(globals.node)]),
].filter((name) => !(name in globals.es2024));

/**
 * Rule 3 of ADR-0015 for code under a module's `src/shared/`.
 * @type {import("eslint").Linter.Config}
 */
export const sharedEntryRules = {
  files: ["core/*/src/shared/**", "modules/*/src/shared/**"],
  rules: {
    "no-restricted-globals": [
      "error",
      ...platformGlobals.map((name) => ({
        name,
        message:
          "Shared code runs on server and client alike; platform APIs are not allowed here (ADR-0015 rule 3).",
      })),
    ],
  },
};

/**
 * Domain code: modules and the kernel. Apps are composition roots — they pass the kernel's
 * `systemClock`, `cryptoRandom`, and `uuidV7Generator` in.
 */
export const domainFiles = ["core/*/src/**", "modules/*/src/**", "packages/kernel/src/**"];

/**
 * ADR-0015 rule 6 and ADR-0018: no float money, no ambient clock, no ambient randomness in
 * domain code. The kernel files that implement `Decimal`, `Clock`, and `RandomSource` are the
 * only exceptions, each for its own rule.
 * @type {import("eslint").Linter.Config[]}
 */
export const domainRules = [
  {
    files: domainFiles,
    plugins: { mustawfi: plugin },
    rules: {
      "mustawfi/no-float-money": "error",
      "mustawfi/no-ambient-clock": "error",
      "mustawfi/no-ambient-randomness": "error",
    },
  },
  {
    files: ["packages/kernel/src/decimal.ts"],
    plugins: { mustawfi: plugin },
    rules: { "mustawfi/no-float-money": ["error", { allowDecimalLibrary: true }] },
  },
  {
    files: ["packages/kernel/src/clock.ts"],
    plugins: { mustawfi: plugin },
    rules: { "mustawfi/no-ambient-clock": "off" },
  },
  {
    files: ["packages/kernel/src/random.ts"],
    plugins: { mustawfi: plugin },
    rules: { "mustawfi/no-ambient-randomness": "off" },
  },
];

/**
 * The project's ESLint flat config.
 * @param {{ tsconfigRootDir: string }} options
 */
export function mustawfi({ tsconfigRootDir }) {
  return defineConfig(
    { ignores: ["**/node_modules/", "**/dist/", "**/coverage/", "**/.turbo/"] },
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
    },
    {
      files: ["**/*.js"],
      extends: [tseslint.configs.disableTypeChecked],
      languageOptions: { globals: globals.node },
    },
    sharedEntryRules,
    domainRules,
  );
}
