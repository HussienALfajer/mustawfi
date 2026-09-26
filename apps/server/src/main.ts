import { openTenantDatabase } from "@mustawfi/core-tenancy/server";
import { cryptoRandom, systemClock, uuidV7Generator } from "@mustawfi/kernel";
import { buildHostServer } from "./host-server.ts";
import { loadServerConfig } from "./config.ts";
import { createServerRegistry } from "./modules.ts";

/** Starts the tenant API: `node src/main.ts` with the environment of `config.ts`. */
const config = loadServerConfig(process.env);
const registry = createServerRegistry(config.DISABLED_MODULES);
const tenants = await openTenantDatabase({ connectionString: config.DATABASE_URL });
const app = await buildHostServer({
  registry,
  services: {
    tenants,
    clock: systemClock,
    random: cryptoRandom,
    newId: uuidV7Generator({ clock: systemClock, random: cryptoRandom }),
  },
  logger: true,
  clientOrigins: config.CLIENT_ORIGINS,
  trustProxy: config.TRUST_PROXY,
});
app.addHook("onClose", () => tenants.close());

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close();
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
