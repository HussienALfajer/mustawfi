import { createServerRegistry } from "../modules.ts";
import type { MigrationSet } from "./migrate.ts";

/**
 * The migration sets of every module this server runs, dependencies first, from the module
 * registry. Disabled modules are migrated too: disabling hides a module, it never drops data.
 */
export const migrationSets: readonly MigrationSet[] = createServerRegistry().migrationSets;
