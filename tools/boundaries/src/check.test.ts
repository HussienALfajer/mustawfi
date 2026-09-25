import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkBoundaries } from "./check.ts";

/** A miniature workspace: repository-relative path → file content (objects become JSON). */
type Tree = Record<string, string | object>;

const moduleExports = {
  "./shared": "./src/shared/index.ts",
  "./server": "./src/server/index.ts",
  "./client": "./src/client/index.ts",
};

/** A workspace that respects every rule; each case below breaks exactly one. */
const cleanTree: Tree = {
  "packages/kernel/package.json": { name: "@mustawfi/kernel", exports: { ".": "./src/index.ts" } },
  "packages/kernel/src/index.ts": "export const kernel = 1;\n",
  "packages/ui/package.json": { name: "@mustawfi/ui", exports: { ".": "./src/index.ts" } },
  "packages/ui/src/index.ts": "export const ui = 1;\n",

  "core/ledger/package.json": {
    name: "@mustawfi/core-ledger",
    exports: moduleExports,
    mustawfi: { dependsOn: [] },
    dependencies: { "@mustawfi/kernel": "workspace:*", "@mustawfi/ui": "workspace:*" },
  },
  "core/ledger/src/shared/index.ts":
    'import { kernel } from "@mustawfi/kernel";\nexport const ledgerShared = kernel;\n',
  "core/ledger/src/server/internal.ts": "export const internal = 1;\n",
  "core/ledger/src/server/index.ts":
    'import { ledgerShared } from "../shared/index.ts";\nimport { internal } from "./internal.ts";\nexport const ledgerServer = ledgerShared + internal;\n',
  "core/ledger/src/client/index.ts":
    'import { ui } from "@mustawfi/ui";\nimport { ledgerShared } from "../shared/index.ts";\nexport const ledgerClient = ledgerShared + ui;\n',

  "modules/sales/package.json": {
    name: "@mustawfi/sales",
    exports: moduleExports,
    mustawfi: { dependsOn: ["core.ledger"] },
    dependencies: { "@mustawfi/core-ledger": "workspace:*", "@mustawfi/ui": "workspace:*" },
  },
  "modules/sales/src/shared/index.ts":
    'import { ledgerShared } from "@mustawfi/core-ledger/shared";\nexport const salesShared = ledgerShared;\n',
  "modules/sales/src/server/index.ts":
    'import { ledgerServer } from "@mustawfi/core-ledger/server";\nexport const salesServer = ledgerServer;\n',
  "modules/sales/src/client/index.ts":
    'import { ledgerClient } from "@mustawfi/core-ledger/client";\nexport const salesClient = ledgerClient;\n',

  "apps/server/package.json": {
    name: "@mustawfi/server",
    dependencies: { "@mustawfi/sales": "workspace:*" },
  },
  "apps/server/src/main.ts":
    'import { salesServer } from "@mustawfi/sales/server";\nexport const app = salesServer;\n',
};

let workspace: string | undefined;

afterEach(() => {
  if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
  workspace = undefined;
});

/** Writes the tree to a temporary directory and links packages the way pnpm does. */
function materialize(tree: Tree): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mustawfi-boundaries-")));
  workspace = root;
  for (const [path, content] of Object.entries(tree)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2));
    if (path.endsWith("/package.json") && typeof content === "object" && "name" in content) {
      const link = join(root, "node_modules", String(content.name));
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(dirname(file), link, "junction");
    }
  }
  return root;
}

async function rulesBrokenBy(overrides: Tree): Promise<string[]> {
  const violations = await checkBoundaries(materialize({ ...cleanTree, ...overrides }));
  return [...new Set(violations.map((v) => v.rule))].sort();
}

describe("boundary check", { timeout: 30_000 }, () => {
  it("passes a workspace that respects every rule", async () => {
    expect(await rulesBrokenBy({})).toEqual([]);
  });

  describe("rule 1: no deep imports", () => {
    it("fails on a package import outside the exports map", async () => {
      expect(
        await rulesBrokenBy({
          "modules/sales/src/server/index.ts":
            'import { internal } from "@mustawfi/core-ledger/src/server/internal.ts";\nexport const salesServer = internal;\n',
        }),
      ).toEqual(["no-unresolvable"]);
    });

    it("fails on a relative import into another package", async () => {
      expect(
        await rulesBrokenBy({
          "modules/sales/src/server/index.ts":
            'import { internal } from "../../../../core/ledger/src/server/internal.ts";\nexport const salesServer = internal;\n',
        }),
      ).toEqual(["no-deep-import"]);
    });

    it("fails when a module exports anything but shared, server, and client", async () => {
      expect(
        await rulesBrokenBy({
          "core/ledger/package.json": {
            ...(cleanTree["core/ledger/package.json"] as object),
            exports: { ...moduleExports, "./internal": "./src/server/internal.ts" },
          },
        }),
      ).toEqual(["module-exports"]);
    });
  });

  describe("rule 2: modules import only what their manifest declares", () => {
    it("fails on an import of a module missing from dependsOn", async () => {
      expect(
        await rulesBrokenBy({
          "modules/sales/package.json": {
            ...(cleanTree["modules/sales/package.json"] as object),
            mustawfi: { dependsOn: [] },
            dependencies: { "@mustawfi/ui": "workspace:*" },
          },
        }),
      ).toEqual(["undeclared-module-dependency"]);
    });

    it("fails on a package.json dependency missing from dependsOn", async () => {
      expect(
        await rulesBrokenBy({
          "core/ledger/package.json": {
            ...(cleanTree["core/ledger/package.json"] as object),
            dependencies: { "@mustawfi/kernel": "workspace:*", "@mustawfi/sales": "workspace:*" },
          },
        }),
      ).toEqual(["undeclared-module-dependency"]);
    });

    it("fails on a dependsOn entry that names no module", async () => {
      expect(
        await rulesBrokenBy({
          "modules/sales/package.json": {
            ...(cleanTree["modules/sales/package.json"] as object),
            mustawfi: { dependsOn: ["core.ledger", "core.nowhere"] },
          },
        }),
      ).toEqual(["manifest-depends-on"]);
    });
  });

  describe("rule 3: client, server, and shared entries", () => {
    it("fails when client code imports server code", async () => {
      expect(
        await rulesBrokenBy({
          "modules/sales/src/client/index.ts":
            'import { ledgerServer } from "@mustawfi/core-ledger/server";\nexport const salesClient = ledgerServer;\n',
        }),
      ).toEqual(["client-not-server"]);
    });

    it("fails when shared code imports client code", async () => {
      expect(
        await rulesBrokenBy({
          "modules/sales/src/shared/index.ts":
            'import { ledgerClient } from "@mustawfi/core-ledger/client";\nexport const salesShared = ledgerClient;\n',
        }),
      ).toEqual(["shared-not-client-or-server"]);
    });

    it("fails when shared code uses a Node built-in", async () => {
      expect(
        await rulesBrokenBy({
          "core/ledger/src/shared/index.ts":
            'import { sep } from "node:path";\nexport const ledgerShared = sep;\n',
        }),
      ).toEqual(["shared-no-platform"]);
    });

    it("fails when shared code imports a client-side package", async () => {
      expect(
        await rulesBrokenBy({
          "core/ledger/src/shared/index.ts":
            'import { ui } from "@mustawfi/ui";\nexport const ledgerShared = ui;\n',
        }),
      ).toEqual(["shared-packages"]);
    });
  });

  describe("rule 4: packages and apps", () => {
    it("fails when a package imports a module", async () => {
      expect(
        await rulesBrokenBy({
          "packages/ui/src/index.ts":
            'import { ledgerShared } from "@mustawfi/core-ledger/shared";\nexport const ui = ledgerShared;\n',
        }),
      ).toEqual(["packages-not-modules"]);
    });

    it("fails when a package imports an app", async () => {
      expect(
        await rulesBrokenBy({
          "apps/server/package.json": {
            ...(cleanTree["apps/server/package.json"] as object),
            exports: { ".": "./src/main.ts" },
          },
          "packages/ui/src/index.ts":
            'import { app } from "@mustawfi/server";\nexport const ui = app;\n',
        }),
      ).toEqual(["packages-not-apps"]);
    });

    it("fails when a module imports an app", async () => {
      expect(
        await rulesBrokenBy({
          "apps/server/package.json": {
            ...(cleanTree["apps/server/package.json"] as object),
            exports: { ".": "./src/main.ts" },
          },
          "core/ledger/src/server/index.ts":
            'import { app } from "@mustawfi/server";\nexport const ledgerServer = app;\n',
        }),
      ).toEqual(["modules-not-apps"]);
    });
  });
});
