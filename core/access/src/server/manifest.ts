import { fileURLToPath } from "node:url";
import { defineModule } from "@mustawfi/core-config/server";
import type { AccessContext } from "./dependencies.ts";
import { accessRoutes } from "./routes.ts";

/** `core.access`: users, password sign-in, sessions, registration codes, and devices. */
export const accessModule = defineModule<AccessContext>({
  id: "core.access",
  dependsOn: ["core.audit", "core.config", "core.tenancy"],
  migrations: fileURLToPath(new URL("../../migrations", import.meta.url)),
  routes: accessRoutes,
});
