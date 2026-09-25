import type { FastifyInstance } from "fastify";

/**
 * What a module declares about itself (`docs/architecture/overview.md` §2). `id` and
 * `dependsOn` must equal the module's `package.json` (`mustawfi.dependsOn`); the server checks
 * this in `apps/server/src/modules.test.ts`. Permissions, settings, templates, and events join
 * the manifest in the units that introduce them.
 *
 * `Context` is what the host hands the module's routes (the tenant database, the clock…);
 * a module states the part it needs.
 */
export interface ModuleManifest<Context = never> {
  /** `core.tenancy`, `inventory`, … — the module's directory under `core/` or `modules/`. */
  readonly id: string;
  /** Module ids this module imports or references; dependencies are mounted first. */
  readonly dependsOn: readonly string[];
  /** Absolute path of the folder `drizzle-kit generate` writes this module's migrations to. */
  readonly migrations?: string;
  /** Registers the module's routes in its own Fastify scope under `routePrefix(id)`. */
  routes?(app: FastifyInstance, context: Context): void | Promise<void>;
}

const MODULE_ID = /^(core\.)?[a-z][a-z0-9-]*$/;

export function defineModule<Context = never>(
  manifest: ModuleManifest<Context>,
): ModuleManifest<Context> {
  for (const id of [manifest.id, ...manifest.dependsOn]) {
    if (!MODULE_ID.test(id)) throw new TypeError(`"${id}" is not a module id`);
  }
  return Object.freeze({ ...manifest, dependsOn: Object.freeze([...manifest.dependsOn]) });
}

/** `core.tenancy` → `/api/v1/tenancy`, `sales` → `/api/v1/sales`. */
export function routePrefix(moduleId: string): string {
  return `/api/v1/${moduleId.replace(/^core\./, "")}`;
}
