import { fileURLToPath } from "node:url";
import { defineModule } from "@mustawfi/core-config/server";
import type { OrganizationContext } from "./dependencies.ts";
import { organizationRoutes } from "./routes.ts";

/**
 * `core.organization`: the store profile and the management of departments (stored by
 * `core.tenancy`, ADR-0030), both flowing down to devices; document numbering comes in slice 4.
 */
export const organizationModule = defineModule<OrganizationContext>({
  id: "core.organization",
  dependsOn: ["core.access", "core.audit", "core.config", "core.sync", "core.tenancy"],
  migrations: fileURLToPath(new URL("../../migrations", import.meta.url)),
  routes: organizationRoutes,
});
