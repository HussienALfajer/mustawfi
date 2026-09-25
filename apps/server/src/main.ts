import { openTenantDatabase } from "@mustawfi/core-tenancy/server";
import { cryptoRandom, systemClock, uuidV7Generator } from "@mustawfi/kernel";
import { buildServer } from "./app.ts";
import { loadServerConfig } from "./config.ts";
import { createServerRegistry, hostSyncOperations } from "./modules.ts";

/** Starts the tenant API: `node src/main.ts` with the environment of `config.ts`. */
const config = loadServerConfig(process.env);
const registry = createServerRegistry(config.DISABLED_MODULES);
const tenants = await openTenantDatabase({ connectionString: config.DATABASE_URL });
const app = await buildServer({
  registry,
  context: {
    tenants,
    clock: systemClock,
    random: cryptoRandom,
    syncOperations: hostSyncOperations(registry),
    newId: uuidV7Generator({ clock: systemClock, random: cryptoRandom }),
  },
  logger: true,
});
app.addHook("onClose", () => tenants.close());

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close();
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
