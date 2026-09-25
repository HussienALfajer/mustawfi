import type { FastifyInstance } from "fastify";
import { routePrefix, type ModuleManifest } from "./module.ts";

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

/**
 * Validates the modules a server runs and orders them. Refuses to start — throws — on a
 * module registered twice, a dependency that is not registered, a dependency cycle, or an
 * enabled module whose dependency is disabled (a module cannot be disabled while an enabled
 * module depends on it).
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
