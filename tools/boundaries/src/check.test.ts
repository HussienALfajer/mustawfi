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

/** Installed npm packages; string content keeps `materialize` from linking them. */
const drizzle: Tree = {
  "node_modules/drizzle-orm/package.json": JSON.stringify({
    name: "drizzle-orm",
    exports: {
      ".": "./index.js",
      "./pg-core": "./pg-core/index.js",
      "./sqlite-core": "./sqlite-core/index.js",
      "./node-postgres": "./node-postgres/index.js",
    },
  }),
  "node_modules/drizzle-orm/index.js": "export const sql = () => 1;\n",
  "node_modules/drizzle-orm/pg-core/index.js":
    "export const pgTable = () => 1;\nexport const pgSchema = () => ({ table: () => 1 });\nexport const uuid = () => 1;\n",
  "node_modules/drizzle-orm/sqlite-core/index.js":
    "export const sqliteTable = () => 1;\nexport const text = () => 1;\n",
  "node_modules/drizzle-orm/node-postgres/index.js": "export const drizzle = 1;\n",
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

  describe("ADR-0017: the database only through core/tenancy", () => {
    const drivers: Tree = {
      ...drizzle,
      "node_modules/pg/package.json": JSON.stringify({ name: "pg", main: "index.js" }),
      "node_modules/pg/index.js": "export default {};\n",
      "core/tenancy/package.json": {
        name: "@mustawfi/core-tenancy",
        exports: moduleExports,
        mustawfi: { dependsOn: [] },
      },
      "core/tenancy/src/server/index.ts":
        'import pg from "pg";\nimport { drizzle } from "drizzle-orm/node-postgres";\nexport const tenancy = [pg, drizzle];\n',
      "modules/sales/src/server/schema.ts":
        'import { pgTable } from "drizzle-orm/pg-core";\nexport const invoices = pgTable;\n',
      "modules/sales/src/server/schema.test.ts": 'import pg from "pg";\nexport const probe = pg;\n',
    };

    it("allows core/tenancy's server entry, schema definitions, and tests", async () => {
      expect(await rulesBrokenBy(drivers)).toEqual([]);
    });

    it("fails when a module imports a PostgreSQL driver", async () => {
      expect(
        await rulesBrokenBy({
          ...drivers,
          "modules/sales/src/server/index.ts":
            'import pg from "pg";\nexport const salesServer = pg;\n',
        }),
      ).toEqual(["database-through-tenancy"]);
    });

    it("fails when a module imports a Drizzle driver adapter", async () => {
      expect(
        await rulesBrokenBy({
          ...drivers,
          "core/ledger/src/server/index.ts":
            'import { drizzle } from "drizzle-orm/node-postgres";\nexport const ledgerServer = drizzle;\n',
        }),
      ).toEqual(["database-through-tenancy"]);
    });
  });

  describe("rule 5: tables stay internal, SQL stays in the module's schema", () => {
    /** sales owns its tables, reads them with its own SQL, and keys them to core.ledger. */
    const owned: Tree = {
      ...drizzle,
      "modules/sales/src/server/schema.ts": [
        'import { pgSchema, uuid } from "drizzle-orm/pg-core";',
        "/** Mirrors core_ledger.entries by id only (FK in the migration). */",
        'export const sales = pgSchema("sales");',
        'export const invoices = sales.table("invoices", { id: uuid(), entryId: uuid() });',
        "",
      ].join("\n"),
      "modules/sales/src/server/invoices.ts": [
        'import { sql } from "drizzle-orm";',
        'import { invoices } from "./schema.ts";',
        "export const count = sql`select count(*) from sales.invoices where id = ${invoices}`;",
        'export const action = "core_ledger.entry.posted";',
        "",
      ].join("\n"),
      "modules/sales/src/server/index.ts": [
        'import { ledgerServer } from "@mustawfi/core-ledger/server";',
        'import { count } from "./invoices.ts";',
        "export const salesServer = [ledgerServer, count];",
        "",
      ].join("\n"),
      "modules/sales/src/client/local.ts": [
        'import { sqliteTable, text } from "drizzle-orm/sqlite-core";',
        'export const localInvoices = sqliteTable("sales_invoices", { id: text() });',
        "",
      ].join("\n"),
      "modules/sales/migrations/0000_sales.sql": [
        "-- Entries live in core_ledger.entries; the key only holds integrity.",
        'CREATE TABLE "sales"."invoices" ("id" uuid PRIMARY KEY, "entry_id" uuid);',
        'ALTER TABLE "sales"."invoices" ADD CONSTRAINT "invoices_entry_fk"',
        '  FOREIGN KEY ("entry_id") REFERENCES "core_ledger"."entries"("id");',
        'GRANT USAGE ON SCHEMA "sales" TO mustawfi_app;',
        'ALTER TABLE "sales"."invoices" ADD CHECK ("kind" IN (\'core_ledger.entry\'));',
        "",
      ].join("\n"),
    };

    it("allows own-schema SQL, internal tables, and foreign keys toward dependsOn", async () => {
      expect(await rulesBrokenBy(owned)).toEqual([]);
    });

    it("fails when an entry exports a table definition", async () => {
      expect(
        await rulesBrokenBy({
          ...owned,
          "modules/sales/src/server/index.ts": 'export { invoices } from "./schema.ts";\n',
        }),
      ).toEqual(["no-table-export"]);
    });

    it("fails when an entry re-exports a table under another name through another file", async () => {
      expect(
        await rulesBrokenBy({
          ...owned,
          "modules/sales/src/server/tables.ts":
            'import { invoices } from "./schema.ts";\nexport const salesInvoices = invoices;\n',
          "modules/sales/src/server/index.ts": 'export * from "./tables.ts";\n',
        }),
      ).toEqual(["no-table-export"]);
    });

    it("fails when an entry exports the schema file as a namespace", async () => {
      expect(
        await rulesBrokenBy({
          ...owned,
          "modules/sales/src/server/index.ts": 'export * as salesSchema from "./schema.ts";\n',
        }),
      ).toEqual(["no-table-export"]);
    });

    it("fails when an entry exports an object holding tables", async () => {
      expect(
        await rulesBrokenBy({
          ...owned,
          "modules/sales/src/server/index.ts":
            'import { invoices } from "./schema.ts";\nexport const tables = { invoices };\n',
        }),
      ).toEqual(["no-table-export"]);
    });

    it("fails when an entry re-exports a default-exported table", async () => {
      expect(
        await rulesBrokenBy({
          ...owned,
          "modules/sales/src/server/flags.ts":
            'import { pgTable } from "drizzle-orm/pg-core";\nexport default pgTable("flags", {});\n',
          "modules/sales/src/server/index.ts": 'export { default as flags } from "./flags.ts";\n',
        }),
      ).toEqual(["no-table-export"]);
    });

    it("fails when an entry exports a table built through a namespace import", async () => {
      expect(
        await rulesBrokenBy({
          ...owned,
          "modules/sales/src/server/index.ts":
            'import * as pg from "drizzle-orm/pg-core";\nexport const flags = pg.pgTable("flags", {});\n',
        }),
      ).toEqual(["no-table-export"]);
    });

    it("fails when a client entry exports a local SQLite table", async () => {
      expect(
        await rulesBrokenBy({
          ...owned,
          "modules/sales/src/client/index.ts": 'export { localInvoices } from "./local.ts";\n',
        }),
      ).toEqual(["no-table-export"]);
    });

    it("fails when a migration reads another module's schema", async () => {
      expect(
        await rulesBrokenBy({
          ...owned,
          "modules/sales/migrations/0001_totals.sql":
            'CREATE VIEW "sales"."totals" AS SELECT id FROM core_ledger.entries;\n',
        }),
      ).toEqual(["own-schema-only"]);
    });

    it("fails when a migration grants on another module's schema", async () => {
      expect(
        await rulesBrokenBy({
          ...owned,
          "modules/sales/migrations/0001_grant.sql": 'GRANT USAGE ON SCHEMA "core_ledger" TO x;\n',
        }),
      ).toEqual(["own-schema-only"]);
    });

    it("fails when a migration drops or creates another module's schema", async () => {
      for (const statement of [
        "DROP SCHEMA IF EXISTS core_ledger CASCADE;",
        'CREATE SCHEMA IF NOT EXISTS "core_ledger";',
      ]) {
        expect(
          await rulesBrokenBy({
            ...owned,
            "modules/sales/migrations/0001_x.sql": `${statement}\n`,
          }),
        ).toEqual(["own-schema-only"]);
      }
    });

    it("fails when a migration puts another module's schema on the search path", async () => {
      expect(
        await rulesBrokenBy({
          ...owned,
          "modules/sales/migrations/0001_path.sql":
            "SET search_path TO sales, core_ledger;\nSELECT id FROM entries;\n",
        }),
      ).toEqual(["own-schema-only"]);
    });

    it("fails on a foreign key toward a module outside dependsOn", async () => {
      expect(
        await rulesBrokenBy({
          ...owned,
          "core/ledger/migrations/0000_ledger.sql": [
            'ALTER TABLE "core_ledger"."entries" ADD CONSTRAINT "entries_invoice_fk"',
            '  FOREIGN KEY ("invoice_id") REFERENCES "sales"."invoices"("id");',
            "",
          ].join("\n"),
        }),
      ).toEqual(["own-schema-only"]);
    });

    it("fails when a sql template reads another module's schema", async () => {
      expect(
        await rulesBrokenBy({
          ...owned,
          "modules/sales/src/server/invoices.ts": [
            'import { sql } from "drizzle-orm";',
            "export const count = sql`select count(*) from core_ledger.entries`;",
            "",
          ].join("\n"),
        }),
      ).toEqual(["own-schema-only"]);
    });

    it("fails when SQL inside a sql template's substitution reads another module's schema", async () => {
      expect(
        await rulesBrokenBy({
          ...owned,
          "modules/sales/src/server/invoices.ts": [
            'import { sql } from "drizzle-orm";',
            'export const count = sql`select ${sql.raw("id from core_ledger.entries")}`;',
            "",
          ].join("\n"),
        }),
      ).toEqual(["own-schema-only"]);
    });

    it("fails when a plain SQL string reads another module's schema", async () => {
      expect(
        await rulesBrokenBy({
          ...owned,
          "modules/sales/src/server/invoices.ts":
            "export const count = 'select count(*) from \"core_ledger\".entries';\n",
        }),
      ).toEqual(["own-schema-only"]);
    });

    it("fails when a Drizzle schema puts tables in another module's schema", async () => {
      expect(
        await rulesBrokenBy({
          ...owned,
          "modules/sales/src/server/ledger-tables.ts": [
            'import { pgSchema } from "drizzle-orm/pg-core";',
            'const ledger = pgSchema("core_ledger");',
            'export const entries = ledger.table("entries", {});',
            "",
          ].join("\n"),
        }),
      ).toEqual(["own-schema-only"]);
    });

    it("fails when a namespace-imported pgSchema names another module's schema", async () => {
      expect(
        await rulesBrokenBy({
          ...owned,
          "modules/sales/src/server/ledger-tables.ts": [
            'import * as pg from "drizzle-orm/pg-core";',
            'const ledger = pg.pgSchema("core_ledger");',
            "export const entries = ledger;",
            "",
          ].join("\n"),
        }),
      ).toEqual(["own-schema-only"]);
    });
  });
});
