import { fileURLToPath } from "node:url";
import { defineModule } from "@mustawfi/core-config/server";
import type { SyncContext } from "./dependencies.ts";
import { syncRoutes } from "./routes.ts";

/**
 * `core.sync`: the server side of offline sync (ADR-0020) — idempotent push dispatched to the
 * modules' operation handlers, and the per-tenant change log devices pull from.
 */
export const syncModule = defineModule<SyncContext>({
  id: "core.sync",
  dependsOn: ["core.access", "core.audit", "core.config", "core.tenancy"],
  migrations: fileURLToPath(new URL("../../migrations", import.meta.url)),
  routes: syncRoutes,
});
