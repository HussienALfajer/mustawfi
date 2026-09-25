import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cruise, type ICruiseResult, type IForbiddenRuleType } from "dependency-cruiser";

/**
 * Boundary checks for the monorepo (ADR-0015).
 *
 * Rules 1 and 2 are checked here against package manifests and the resolved import graph;
 * rules 3 and 4 are dependency-cruiser path rules (`forbiddenRules` below), and so is the
 * ADR-0017 rule that only `core/tenancy`'s server entry reaches a database driver.
 */

export interface Violation {
  rule: string;
  from: string;
  to: string;
  message: string;
}

type Layer = "apps" | "core" | "modules" | "packages" | "tools";

const LAYERS: readonly Layer[] = ["apps", "core", "modules", "packages", "tools"];
const MODULE_ENTRIES = ["./shared", "./server", "./client"] as const;

interface PackageJson {
  name?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  mustawfi?: { dependsOn?: unknown };
}

interface WorkspacePackage {
  /** Repository-relative directory with forward slashes, e.g. `core/ledger`. */
  dir: string;
  layer: Layer;
  json: PackageJson;
  /** Module id (`core.ledger`, `sales`) for packages under `core/` and `modules/`. */
  moduleId?: string;
  /** Repository-relative files the package exposes through `exports`. */
  exportTargets: RegExp[];
}

const ENTRY = "(core|modules)/[^/]+/src";
const TEST_FILE = "\\.test\\.[cm]?[jt]sx?$";
/** PostgreSQL drivers, and the Drizzle adapters that wrap them, as installed paths. */
const DATABASE_DRIVERS =
  "(^|/)node_modules/(pg|pg-pool|postgres|@electric-sql/pglite|drizzle-orm/(node-postgres|postgres-js|pg-proxy|pglite|neon-http|neon-serverless))/";

/** ADR-0015 rules 3 and 4, plus the entry table's package allowances. */
export const forbiddenRules: IForbiddenRuleType[] = [
  {
    name: "client-not-server",
    comment: "Rule 3: a module's client entry never imports a server entry.",
    severity: "error",
    from: { path: `^${ENTRY}/client/` },
    to: { path: `^${ENTRY}/server/` },
  },
  {
    name: "server-not-client",
    comment: "Entry table: a server entry never imports a client entry.",
    severity: "error",
    from: { path: `^${ENTRY}/server/` },
    to: { path: `^${ENTRY}/client/` },
  },
  {
    name: "shared-not-client-or-server",
    comment: "Rule 3: a shared entry imports neither client nor server entries.",
    severity: "error",
    from: { path: `^${ENTRY}/shared/` },
    to: { path: `^${ENTRY}/(client|server)/` },
  },
  {
    name: "shared-no-platform",
    comment: "Rule 3: shared code has no platform APIs, so no Node built-ins.",
    severity: "error",
    from: { path: `^${ENTRY}/shared/`, pathNot: TEST_FILE },
    to: { dependencyTypes: ["core"] },
  },
  {
    name: "shared-packages",
    comment: "Entry table: shared code may import only packages/kernel among packages.",
    severity: "error",
    from: { path: `^${ENTRY}/shared/`, pathNot: TEST_FILE },
    to: { path: "^packages/", pathNot: "^packages/kernel/" },
  },
  {
    name: "server-packages",
    comment: "Entry table: server code does not import the client-side packages.",
    severity: "error",
    from: { path: `^${ENTRY}/server/`, pathNot: TEST_FILE },
    to: { path: "^packages/(ui|i18n|local-db)/" },
  },
  {
    name: "database-through-tenancy",
    comment:
      "ADR-0017: only core/tenancy's server entry opens database connections; modules reach the database through withTenant.",
    severity: "error",
    from: { path: `^${ENTRY}/`, pathNot: `^core/tenancy/src/server/|${TEST_FILE}` },
    to: { path: DATABASE_DRIVERS },
  },
  {
    name: "packages-not-modules",
    comment: "Rule 4: packages never import modules.",
    severity: "error",
    from: { path: "^packages/" },
    to: { path: "^(core|modules)/" },
  },
  {
    name: "packages-not-apps",
    comment: "Rule 4: packages never import apps.",
    severity: "error",
    from: { path: "^packages/" },
    to: { path: "^apps/" },
  },
  {
    name: "modules-not-apps",
    comment: "Rule 4: modules never import apps.",
    severity: "error",
    from: { path: "^(core|modules)/" },
    to: { path: "^apps/" },
  },
];

function readJson(file: string): PackageJson {
  return JSON.parse(readFileSync(file, "utf8")) as PackageJson;
}

function collectTargets(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectTargets(v, out);
  else if (value !== null && typeof value === "object")
    for (const v of Object.values(value)) collectTargets(v, out);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exportTargets(dir: string, exportsField: unknown): RegExp[] {
  const targets: string[] = [];
  collectTargets(exportsField, targets);
  return targets.map((target) => {
    const path = `${dir}/${target.replace(/^\.\//, "")}`;
    return new RegExp(`^${path.split("*").map(escapeRegExp).join(".+")}$`);
  });
}

function moduleIdOf(layer: Layer, name: string): string | undefined {
  if (layer === "core") return `core.${name}`;
  if (layer === "modules") return name;
  return undefined;
}

function expectedPackageName(layer: Layer, name: string): string | undefined {
  if (layer === "core") return `@mustawfi/core-${name}`;
  if (layer === "modules") return `@mustawfi/${name}`;
  return undefined;
}

export function discoverPackages(rootDir: string): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  for (const layer of LAYERS) {
    const layerDir = join(rootDir, layer);
    if (!existsSync(layerDir)) continue;
    for (const entry of readdirSync(layerDir, { withFileTypes: true })) {
      const manifest = join(layerDir, entry.name, "package.json");
      if (!entry.isDirectory() || !existsSync(manifest)) continue;
      const dir = `${layer}/${entry.name}`;
      const json = readJson(manifest);
      const moduleId = moduleIdOf(layer, entry.name);
      packages.push({
        dir,
        layer,
        json,
        ...(moduleId === undefined ? {} : { moduleId }),
        exportTargets: exportTargets(dir, json.exports),
      });
    }
  }
  return packages;
}

function dependsOnOf(pkg: WorkspacePackage): string[] {
  const dependsOn = pkg.json.mustawfi?.dependsOn;
  return Array.isArray(dependsOn) ? dependsOn.filter((d) => typeof d === "string") : [];
}

/** Rules 1 and 2 as far as they can be read from the manifests alone. */
function checkManifests(packages: WorkspacePackage[]): Violation[] {
  const violations: Violation[] = [];
  const modules = packages.filter((p) => p.moduleId !== undefined);
  const moduleByName = new Map(modules.map((m) => [m.json.name, m]));
  const moduleIds = new Set(modules.map((m) => m.moduleId));

  for (const pkg of modules) {
    const from = `${pkg.dir}/package.json`;
    const [layer, name] = pkg.dir.split("/") as [Layer, string];
    const expectedName = expectedPackageName(layer, name);
    if (pkg.json.name !== expectedName) {
      violations.push({
        rule: "module-package-name",
        from,
        to: String(pkg.json.name),
        message: `module package must be named ${expectedName}`,
      });
    }

    const exportsField = pkg.json.exports;
    const entries =
      exportsField !== null && typeof exportsField === "object" && !Array.isArray(exportsField)
        ? Object.entries(exportsField)
        : [];
    if (entries.length === 0) {
      violations.push({
        rule: "module-exports",
        from,
        to: "exports",
        message: "a module declares an exports map with its ./shared, ./server, ./client entries",
      });
    }
    for (const [key, value] of entries) {
      const targets: string[] = [];
      collectTargets(value, targets);
      const allowed = (MODULE_ENTRIES as readonly string[]).includes(key);
      const inside = targets.every((t) => t.startsWith(`./src/${key.slice(2)}/`));
      if (!allowed || !inside) {
        violations.push({
          rule: "module-exports",
          from,
          to: key,
          message: allowed
            ? `export ${key} must point inside ./src/${key.slice(2)}/`
            : `a module exposes only ${MODULE_ENTRIES.join(", ")}; ${key} is a deep entry`,
        });
      }
    }

    const rawDependsOn = pkg.json.mustawfi?.dependsOn;
    if (!Array.isArray(rawDependsOn) || rawDependsOn.some((d) => typeof d !== "string")) {
      violations.push({
        rule: "manifest-depends-on",
        from,
        to: "mustawfi.dependsOn",
        message: "a module declares mustawfi.dependsOn as a list of module ids",
      });
    }
    const dependsOn = dependsOnOf(pkg);
    for (const id of dependsOn) {
      if (!moduleIds.has(id) || id === pkg.moduleId) {
        violations.push({
          rule: "manifest-depends-on",
          from,
          to: id,
          message:
            id === pkg.moduleId ? "a module cannot depend on itself" : `unknown module id ${id}`,
        });
      }
    }

    const declared = {
      ...pkg.json.dependencies,
      ...pkg.json.devDependencies,
      ...pkg.json.peerDependencies,
    };
    for (const depName of Object.keys(declared)) {
      const dep = moduleByName.get(depName);
      if (dep?.moduleId !== undefined && !dependsOn.includes(dep.moduleId)) {
        violations.push({
          rule: "undeclared-module-dependency",
          from,
          to: depName,
          message: `package.json lists ${depName} but mustawfi.dependsOn does not include ${dep.moduleId}`,
        });
      }
    }
  }
  return violations;
}

function packageOf(packages: WorkspacePackage[], path: string): WorkspacePackage | undefined {
  return packages.find((p) => path.startsWith(`${p.dir}/`));
}

/** Rules 1 and 2 against the resolved import graph. */
function checkGraph(packages: WorkspacePackage[], result: ICruiseResult): Violation[] {
  const violations: Violation[] = [];
  for (const mod of result.modules) {
    const fromPkg = packageOf(packages, mod.source);
    if (fromPkg === undefined) continue;
    for (const dep of mod.dependencies) {
      if (dep.couldNotResolve) {
        violations.push({
          rule: "no-unresolvable",
          from: mod.source,
          to: dep.module,
          message:
            "import does not resolve; a path outside a package's exports map is a deep import (rule 1)",
        });
        continue;
      }
      const toPkg = packageOf(packages, dep.resolved);
      if (toPkg === undefined || toPkg === fromPkg) continue;
      if (!toPkg.exportTargets.some((target) => target.test(dep.resolved))) {
        violations.push({
          rule: "no-deep-import",
          from: mod.source,
          to: dep.resolved,
          message: `${toPkg.dir} does not export this file; import through its package entries (rule 1)`,
        });
      }
      if (
        fromPkg.moduleId !== undefined &&
        toPkg.moduleId !== undefined &&
        !dependsOnOf(fromPkg).includes(toPkg.moduleId)
      ) {
        violations.push({
          rule: "undeclared-module-dependency",
          from: mod.source,
          to: dep.resolved,
          message: `${fromPkg.moduleId} imports ${toPkg.moduleId} without listing it in mustawfi.dependsOn (rule 2)`,
        });
      }
    }
  }
  return violations;
}

export async function checkBoundaries(rootDir: string): Promise<Violation[]> {
  const packages = discoverPackages(rootDir);
  const violations = checkManifests(packages);

  const roots = LAYERS.filter((layer) => existsSync(join(rootDir, layer)));
  if (roots.length === 0) return violations;

  const { output } = await cruise(roots, {
    baseDir: rootDir,
    validate: true,
    ruleSet: { forbidden: forbiddenRules },
    tsPreCompilationDeps: true,
    // node_modules stays in the graph as unfollowed leaves, so rules can see npm imports.
    exclude: { path: "(^|/)(dist|coverage|\\.turbo)/" },
    doNotFollow: { path: "node_modules" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "node", "default"],
    },
  });
  if (typeof output === "string") throw new Error("dependency-cruiser returned a report string");

  violations.push(...checkGraph(packages, output));
  for (const v of output.summary.violations) {
    violations.push({
      rule: v.rule.name,
      from: v.from,
      to: v.to,
      message: forbiddenRules.find((r) => r.name === v.rule.name)?.comment ?? v.rule.name,
    });
  }
  return violations;
}
