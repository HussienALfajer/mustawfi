import { readFileSync } from "node:fs";
import { parseTotpKeys } from "@mustawfi/core-access/server";
import { parseBundleSigningKey } from "@mustawfi/core-config/server";
import { openTenantDatabase } from "@mustawfi/core-tenancy/server";
import { cryptoRandom, systemClock, uuidV7Generator } from "@mustawfi/kernel";
import { buildHostServer } from "./host-server.ts";
import { loadServerConfig } from "./config.ts";
import { createServerRegistry } from "./modules.ts";

/** Starts the tenant API: `node src/main.ts` with the environment of `config.ts`. */
const config = loadServerConfig(process.env);
const registry = createServerRegistry(config.DISABLED_MODULES);
// Read before anything opens: a missing or malformed key file stops the start (the reason names
// the line, never a key).
const totpKeys = parseTotpKeys(readFileSync(config.TOTP_KEYS_FILE, "utf8"));
const bundleKey = await parseBundleSigningKey(readFileSync(config.BUNDLE_KEY_FILE, "utf8"));
const tenants = await openTenantDatabase({ connectionString: config.DATABASE_URL });
const app = await buildHostServer({
  registry,
  services: {
    tenants,
    clock: systemClock,
    random: cryptoRandom,
    newId: uuidV7Generator({ clock: systemClock, random: cryptoRandom }),
    totpKeys,
    bundleKey,
  },
  logger: true,
  clientOrigins: config.CLIENT_ORIGINS,
  trustProxy: config.TRUST_PROXY,
});
app.addHook("onClose", () => tenants.close());
// The public half: what the apps must be built with to trust this server's bundles.
app.log.info({ bundleKey: bundleKey.publicKey }, "configuration bundles are signed with this key");
app.log.info(
  { trustProxy: config.TRUST_PROXY },
  config.TRUST_PROXY.length === 0
    ? "no reverse proxy is trusted: client addresses are the peers' own"
    : "client addresses come from X-Forwarded-For through the trusted proxies",
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close();
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
