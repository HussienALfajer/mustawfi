import { fileURLToPath } from "node:url";
import { defineModule } from "@mustawfi/core-config/server";
import type { OrganizationContext } from "./dependencies.ts";
import { organizationRoutes } from "./routes.ts";

/**
 * `core.organization`: the store profile and the management of departments (stored by
 * `core.tenancy`, ADR-0030), both flowing down to devices, and document numbering — the number
 * format every module uses and the server's view of each device's sequences.
 */
export const organizationModule = defineModule<OrganizationContext>({
  id: "core.organization",
  dependsOn: ["core.access", "core.audit", "core.config", "core.sync", "core.tenancy"],
  permissions: [
    { id: "organization.profile.edit" },
    { id: "organization.departments.manage" },
    // The «License and plan» screen: owners by default, granted to no template.
    { id: "organization.license.view" },
  ],
  migrations: fileURLToPath(new URL("../../migrations", import.meta.url)),
  routes: organizationRoutes,
});
