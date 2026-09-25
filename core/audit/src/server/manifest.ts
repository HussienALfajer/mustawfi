import { fileURLToPath } from "node:url";
import { defineModule } from "@mustawfi/core-config/server";

/**
 * `core.audit`: the append-only audit log every module writes to (non-negotiable 10). It sits
 * below `core.access` so access can audit sign-ins; the owner's view of the log comes later.
 */
export const auditModule = defineModule({
  id: "core.audit",
  dependsOn: ["core.config", "core.tenancy"],
  /** Reading the log (`core-foundation` rule 35); the screen and its route come in slice 17. */
  permissions: [{ id: "audit.view", grants: ["accountant"] }],
  migrations: fileURLToPath(new URL("../../migrations", import.meta.url)),
});
