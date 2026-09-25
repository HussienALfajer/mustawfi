import { fileURLToPath } from "node:url";
import { defineModule } from "@mustawfi/core-config/server";

/** `core.access`: users; sessions, devices, and login join in the next slice. */
export const accessModule = defineModule({
  id: "core.access",
  dependsOn: ["core.config", "core.tenancy"],
  migrations: fileURLToPath(new URL("../../migrations", import.meta.url)),
});
