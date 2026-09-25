import { accessModule } from "@mustawfi/core-access/server";
import {
  configModule,
  createModuleRegistry,
  type ModuleManifest,
  type ModuleRegistry,
} from "@mustawfi/core-config/server";
import { tenancyModule, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import type { Clock, IdGenerator } from "@mustawfi/kernel";

/** What the host hands every module's routes. */
export interface HostContext {
  readonly tenants: TenantDatabase;
  readonly clock: Clock;
  readonly newId: IdGenerator;
}

/** Every module this server runs. A module missing here fails `modules.test.ts`. */
export const serverModules: readonly ModuleManifest<HostContext>[] = [
  configModule,
  tenancyModule,
  accessModule,
];

export function createServerRegistry(
  disabled: readonly string[] = [],
): ModuleRegistry<HostContext> {
  return createModuleRegistry(serverModules, { disabled });
}
