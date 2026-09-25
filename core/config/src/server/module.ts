import type { FastifyInstance } from "fastify";
import { documentCodeSchema } from "../shared/document-code.ts";
import {
  type LimitDeclaration,
  limitIdSchema,
  limitKindSchema,
  limitValueSchema,
  type PermissionDeclaration,
  permissionIdSchema,
  permissionPrefix,
  roleTemplateSchema,
} from "../shared/permissions.ts";

/**
 * What a module declares about itself (`docs/architecture/overview.md` §2). `id` and
 * `dependsOn` must equal the module's `package.json` (`mustawfi.dependsOn`); the server checks
 * this in `apps/server/src/modules.test.ts`. Settings, templates, and events join the manifest
 * in the units that introduce them.
 *
 * `Context` is what the host hands the module's routes (the tenant database, the clock…);
 * a module states the part it needs.
 */
export interface ModuleManifest<Context = never> {
  /** `core.tenancy`, `inventory`, … — the module's directory under `core/` or `modules/`. */
  readonly id: string;
  /** Module ids this module imports or references; dependencies are mounted first. */
  readonly dependsOn: readonly string[];
  /**
   * The codes of the document types this module numbers (`INV`…), three upper-case letters
   * each; the registry refuses a code two modules declare (`core-foundation` rule 30).
   */
  readonly documentCodes?: readonly string[];
  /**
   * The permissions this module's routes and sync operations check, with the role templates
   * that hold them by default (`core-foundation` rule 13). Ids start with the module's id
   * without `core.` (`inventory.products.view`, `audit.view`).
   */
  readonly permissions?: readonly PermissionDeclaration[];
  /** The limits this module checks, with each template's starting value (rule 16). */
  readonly limits?: readonly LimitDeclaration[];
  /** Absolute path of the folder `drizzle-kit generate` writes this module's migrations to. */
  readonly migrations?: string;
  /** Registers the module's routes in its own Fastify scope under `routePrefix(id)`. */
  routes?(app: FastifyInstance, context: Context): void | Promise<void>;
}

const MODULE_ID = /^(core\.)?[a-z][a-z0-9-]*$/;

/**
 * Checks a module's permission and limit declarations on their own: well-formed ids under the
 * module's prefix, none twice, known templates, valid kinds and values. Throws a `TypeError`
 * naming the first fault. The registry runs it again, since a manifest need not come from
 * `defineModule`, and adds the checks across modules.
 */
export function checkAccessDeclarations(
  manifest: Pick<ModuleManifest, "id" | "permissions" | "limits">,
): void {
  const prefix = `${permissionPrefix(manifest.id)}.`;
  const declared = (kind: string, id: string, seen: Set<string>) => {
    if (!id.startsWith(prefix)) {
      throw new TypeError(`${kind} ${id} of module ${manifest.id} must start with "${prefix}"`);
    }
    if (seen.has(id)) throw new TypeError(`module ${manifest.id} declares ${kind} ${id} twice`);
    seen.add(id);
  };
  const unknownTemplate = (kind: string, id: string, template: string) =>
    new TypeError(`${kind} ${id} of module ${manifest.id} names unknown template "${template}"`);

  const permissions = new Set<string>();
  for (const permission of manifest.permissions ?? []) {
    if (!permissionIdSchema.safeParse(permission.id).success) {
      throw new TypeError(`"${permission.id}" is not a permission id`);
    }
    declared("permission", permission.id, permissions);
    for (const template of permission.grants ?? []) {
      if (!roleTemplateSchema.safeParse(template).success) {
        throw unknownTemplate("permission", permission.id, template);
      }
    }
    if (new Set(permission.grants).size !== (permission.grants ?? []).length) {
      throw new TypeError(`permission ${permission.id} grants a template twice`);
    }
  }
  const limits = new Set<string>();
  for (const limit of manifest.limits ?? []) {
    if (!limitIdSchema.safeParse(limit.id).success) {
      throw new TypeError(`"${limit.id}" is not a limit id`);
    }
    declared("limit", limit.id, limits);
    if (!limitKindSchema.safeParse(limit.kind).success) {
      throw new TypeError(`limit ${limit.id} has unknown kind "${String(limit.kind)}"`);
    }
    for (const [template, value] of Object.entries(limit.grants ?? {})) {
      if (!roleTemplateSchema.safeParse(template).success) {
        throw unknownTemplate("limit", limit.id, template);
      }
      if (!limitValueSchema.safeParse(value).success) {
        throw new TypeError(`limit ${limit.id} grants ${template} the malformed value "${value}"`);
      }
    }
  }
  for (const id of permissions) {
    if (limits.has(id)) throw new TypeError(`${id} is declared as a permission and a limit`);
  }
}

export function defineModule<Context = never>(
  manifest: ModuleManifest<Context>,
): ModuleManifest<Context> {
  for (const id of [manifest.id, ...manifest.dependsOn]) {
    if (!MODULE_ID.test(id)) throw new TypeError(`"${id}" is not a module id`);
  }
  const documentCodes = manifest.documentCodes ?? [];
  for (const code of documentCodes) {
    if (!documentCodeSchema.safeParse(code).success) {
      throw new TypeError(`"${code}" is not a document code`);
    }
  }
  if (new Set(documentCodes).size !== documentCodes.length) {
    throw new TypeError(`module ${manifest.id} declares a document code twice`);
  }
  checkAccessDeclarations(manifest);
  return Object.freeze({
    ...manifest,
    dependsOn: Object.freeze([...manifest.dependsOn]),
    ...(manifest.documentCodes === undefined
      ? {}
      : { documentCodes: Object.freeze([...documentCodes]) }),
    ...(manifest.permissions === undefined
      ? {}
      : {
          permissions: Object.freeze(
            manifest.permissions.map((p) =>
              Object.freeze({ ...p, grants: Object.freeze([...(p.grants ?? [])]) }),
            ),
          ),
        }),
    ...(manifest.limits === undefined
      ? {}
      : {
          limits: Object.freeze(
            manifest.limits.map((l) =>
              Object.freeze({ ...l, grants: Object.freeze({ ...l.grants }) }),
            ),
          ),
        }),
  });
}

/** `core.tenancy` → `/api/v1/tenancy`, `sales` → `/api/v1/sales`. */
export function routePrefix(moduleId: string): string {
  return `/api/v1/${moduleId.replace(/^core\./, "")}`;
}
