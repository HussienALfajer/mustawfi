import { fileURLToPath } from "node:url";
import { defineModule } from "@mustawfi/core-config/server";

/** `core.tenancy`: tenants, branches, and the tenant context every database access runs in. */
export const tenancyModule = defineModule({
  id: "core.tenancy",
  dependsOn: ["core.config"],
  migrations: fileURLToPath(new URL("../../migrations", import.meta.url)),
});
