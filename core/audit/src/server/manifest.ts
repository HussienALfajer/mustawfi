import { fileURLToPath } from "node:url";
import { defineModule } from "@mustawfi/core-config/server";
import type { AuditContext } from "./dependencies.ts";
import { auditRoutes } from "./routes.ts";

/**
 * `core.audit`: the append-only audit log every module writes to (non-negotiable 10). It sits
 * below `core.access` so access can audit sign-ins; owners and holders of `audit.view` read it
 * through `GET /api/v1/audit/entries`.
 */
export const auditModule = defineModule<AuditContext>({
  id: "core.audit",
  dependsOn: ["core.config", "core.tenancy"],
  /** Reading the log (`core-foundation` rule 35). */
  permissions: [{ id: "audit.view", grants: ["accountant"] }],
  migrations: fileURLToPath(new URL("../../migrations", import.meta.url)),
  routes: auditRoutes,
});
