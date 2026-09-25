import type { FastifyInstance } from "fastify";
import type {
  DeclaredLimit,
  DeclaredPermission,
  PermissionCatalogue,
} from "../shared/permissions.ts";
import { checkAccessDeclarations, routePrefix, type ModuleManifest } from "./module.ts";

export class ModuleRegistryError extends Error {
  override name = "ModuleRegistryError";
}

export interface ModuleRegistry<Context> {
  /** Every registered module, dependencies before dependents. */
  readonly modules: readonly ModuleManifest<Context>[];
  /** The enabled modules, dependencies before dependents. */
  readonly enabled: readonly ModuleManifest<Context>[];
  /**
   * The migration sets of every registered module, enabled or not: a disabled module keeps
   * its tables and data (`docs/architecture/overview.md` §2).
   */
  readonly migrationSets: readonly { readonly moduleId: string; readonly dir: string }[];
  /** Every declared document code with the module that declared it, enabled or not. */
  readonly documentCodes: ReadonlyMap<string, string>;
  /**
   * Every declared permission and limit, enabled or not: a disabled module's permissions stay
   * on the roles that hold them, ready for when it is enabled again.
   */
  readonly permissions: PermissionCatalogue;
  /** Registers the routes of every enabled module, each in its own scope. */
  mount(app: FastifyInstance, context: Context): Promise<void>;
}

export interface ModuleRegistryOptions {
  /** Module ids switched off for this deployment. */
  readonly disabled?: readonly string[];
}

/** Dependencies first, registration order otherwise; refuses a cycle. */
function dependencyOrder<Context>(
  byId: ReadonlyMap<string, ModuleManifest<Context>>,
): ModuleManifest<Context>[] {
  const ordered: ModuleManifest<Context>[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (module: ModuleManifest<Context>, path: readonly string[]) => {
    const seen = state.get(module.id);
    if (seen === "done") return;
    if (seen === "visiting") {
      const cycle = [...path.slice(path.indexOf(module.id)), module.id];
      throw new ModuleRegistryError(`dependency cycle: ${cycle.join(" → ")}`);
    }
    state.set(module.id, "visiting");
    for (const dependency of module.dependsOn) {
      const next = byId.get(dependency);
      if (next !== undefined) visit(next, [...path, module.id]);
    }
    state.set(module.id, "done");
    ordered.push(module);
  };
  for (const module of byId.values()) visit(module, []);
  return ordered;
}

/** The permissions and limits of `modules`; refuses what `checkAccessDeclarations` refuses. */
function permissionCatalogue<Context>(
  modules: readonly ModuleManifest<Context>[],
): PermissionCatalogue {
  const permissions = new Map<string, DeclaredPermission>();
  const limits = new Map<string, DeclaredLimit>();
  for (const module of modules) {
    try {
      checkAccessDeclarations(module);
    } catch (error) {
      throw new ModuleRegistryError((error as Error).message, { cause: error });
    }
    for (const permission of module.permissions ?? []) {
      const owner = permissions.get(permission.id)?.moduleId ?? limits.get(permission.id)?.moduleId;
      if (owner !== undefined) {
        throw new ModuleRegistryError(
          `permission ${permission.id} is declared by both ${owner} and ${module.id}`,
        );
      }
      permissions.set(permission.id, {
        id: permission.id,
        moduleId: module.id,
        scoped: permission.scoped ?? false,
        grants: [...(permission.grants ?? [])],
      });
    }
    for (const limit of module.limits ?? []) {
      const owner = limits.get(limit.id)?.moduleId ?? permissions.get(limit.id)?.moduleId;
      if (owner !== undefined) {
        throw new ModuleRegistryError(
          `limit ${limit.id} is declared by both ${owner} and ${module.id}`,
        );
      }
      limits.set(limit.id, {
        id: limit.id,
        moduleId: module.id,
        kind: limit.kind,
        grants: { ...limit.grants },
      });
    }
  }
  return { permissions, limits };
}

/**
 * Validates the modules a server runs and orders them. Refuses to start — throws — on a
 * module registered twice, a dependency that is not registered, a dependency cycle, an
 * enabled module whose dependency is disabled (a module cannot be disabled while an enabled
 * module depends on it), a document code two modules declare, or a malformed, repeated, or
 * wrongly granted permission or limit (`core-foundation` rule 13).
 */
export function createModuleRegistry<Context>(
  modules: readonly ModuleManifest<Context>[],
  options: ModuleRegistryOptions = {},
): ModuleRegistry<Context> {
  const byId = new Map<string, ModuleManifest<Context>>();
  for (const module of modules) {
    if (byId.has(module.id)) {
      throw new ModuleRegistryError(`module ${module.id} is registered twice`);
    }
    byId.set(module.id, module);
  }
  for (const module of modules) {
    for (const dependency of module.dependsOn) {
      if (!byId.has(dependency)) {
        throw new ModuleRegistryError(
          `module ${module.id} depends on ${dependency}, which is not registered`,
        );
      }
    }
  }

  // A disabled module's documents keep their numbers, so its codes stay taken.
  const documentCodes = new Map<string, string>();
  for (const module of modules) {
    for (const code of module.documentCodes ?? []) {
      const owner = documentCodes.get(code);
      if (owner !== undefined) {
        throw new ModuleRegistryError(
          `document code ${code} is declared by both ${owner} and ${module.id}`,
        );
      }
      documentCodes.set(code, module.id);
    }
  }

  const permissions = permissionCatalogue(modules);

  const disabled = new Set(options.disabled ?? []);
  for (const id of disabled) {
    if (!byId.has(id)) throw new ModuleRegistryError(`cannot disable ${id}: it is not registered`);
  }

  const ordered = dependencyOrder(byId);
  const enabled = ordered.filter((module) => !disabled.has(module.id));
  for (const module of enabled) {
    for (const dependency of module.dependsOn) {
      if (disabled.has(dependency)) {
        throw new ModuleRegistryError(
          `module ${module.id} is enabled but depends on ${dependency}, which is disabled`,
        );
      }
    }
  }

  return {
    modules: ordered,
    enabled,
    migrationSets: ordered.flatMap((module) =>
      module.migrations === undefined ? [] : [{ moduleId: module.id, dir: module.migrations }],
    ),
    documentCodes,
    permissions,
    async mount(app, context) {
      for (const module of enabled) {
        if (module.routes === undefined) continue;
        const routes = module.routes.bind(module);
        await app.register(
          async (scope) => {
            await routes(scope, context);
          },
          { prefix: routePrefix(module.id) },
        );
      }
    },
  };
}
