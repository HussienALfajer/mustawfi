import { accessLocalMigrations, pinLocalMigrations } from "@mustawfi/core-access/client";
import { configLocalMigrations } from "@mustawfi/core-config/client";
import { organizationLocalMigrations } from "@mustawfi/core-organization/client";
import { syncLocalMigrations } from "@mustawfi/core-sync/client";
import { inventoryLocalMigrations } from "@mustawfi/inventory/client";
import type { LocalMigration } from "@mustawfi/local-db";
import { salesLocalMigrations } from "@mustawfi/sales/client";
import { tenancyLocalMigrations } from "@mustawfi/core-tenancy/client";

/**
 * Every module's local schema (ADR-0019). Devices match applied migrations by position, so a
 * released list only ever grows at its end: a new module's migrations go last, whatever its
 * place in the dependency order.
 */
export const LOCAL_MIGRATIONS: readonly LocalMigration[] = [
  ...accessLocalMigrations,
  ...syncLocalMigrations,
  ...inventoryLocalMigrations,
  ...salesLocalMigrations,
  ...organizationLocalMigrations,
  ...configLocalMigrations,
  ...tenancyLocalMigrations,
  ...pinLocalMigrations,
];
