import type { MigrationSet } from "./migrate.ts";

/**
 * The migration sets of the modules this server runs, dependencies first. Each module adds its
 * own through its server entry as it gains tables (`core.tenancy` in slice 5); the module
 * registry takes this list over when it lands.
 */
export const migrationSets: readonly MigrationSet[] = [];
