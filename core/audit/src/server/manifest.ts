import { fileURLToPath } from "node:url";
import { defineModule } from "@mustawfi/core-config/server";

/**
 * `core.audit`: the append-only audit log every module writes to (non-negotiable 10). It sits
 * below `core.access` so access can audit sign-ins; the owner's view of the log comes later.
 */
export const auditModule = defineModule({
  id: "core.audit",
  dependsOn: ["core.config", "core.tenancy"],
  migrations: fileURLToPath(new URL("../../migrations", import.meta.url)),
});
