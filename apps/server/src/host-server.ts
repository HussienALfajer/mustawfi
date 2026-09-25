import { installRouteAccess } from "@mustawfi/core-access/server";
import type { ModuleRegistry } from "@mustawfi/core-config/server";
import type { FastifyInstance } from "fastify";
import { buildServer, type ServerOptions } from "./app.ts";
import { type HostContext, hostContext } from "./modules.ts";

export interface HostServerOptions extends Omit<
  ServerOptions<HostContext>,
  "context" | "guard" | "registry"
> {
  readonly registry: ModuleRegistry<HostContext>;
  /** The host's services; the sync operations and permissions come from the registry. */
  readonly services: Omit<HostContext, "syncOperations" | "permissionCatalogue">;
}

/**
 * The tenant API with this server's modules, every route behind `core.access`'s guard
 * (`core-foundation` rule 17). `main.ts` and the integration tests start it the same way.
 */
export async function buildHostServer(options: HostServerOptions): Promise<FastifyInstance> {
  const { services, ...rest } = options;
  const context = hostContext(options.registry, services);
  return buildServer({
    ...rest,
    context,
    guard: (app) => {
      installRouteAccess(app, context);
    },
  });
}
