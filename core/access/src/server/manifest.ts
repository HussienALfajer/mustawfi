import { fileURLToPath } from "node:url";
import { defineModule } from "@mustawfi/core-config/server";
import type { AccessContext } from "./dependencies.ts";
import { accessRoutes } from "./routes.ts";

/**
 * `core.access`: users, roles and permissions, password sign-in, sessions, registration codes,
 * and devices. Its permissions are `core-foundation`'s *Permissions* table.
 */
export const accessModule = defineModule<AccessContext>({
  id: "core.access",
  dependsOn: ["core.audit", "core.config", "core.tenancy"],
  permissions: [
    { id: "access.users.view", grants: ["accountant"] },
    { id: "access.users.manage" },
    { id: "access.users.unlock", grants: ["accountant"] },
    { id: "access.roles.manage" },
    { id: "access.devices.manage" },
  ],
  migrations: fileURLToPath(new URL("../../migrations", import.meta.url)),
  routes: accessRoutes,
});
