import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

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
  );
}
