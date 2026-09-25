import { accessModule } from "@mustawfi/core-access/server";
import { auditModule } from "@mustawfi/core-audit/server";
import {
  configModule,
  createModuleRegistry,
  type ModuleManifest,
  type ModuleRegistry,
} from "@mustawfi/core-config/server";
import { tenancyModule, type TenantDatabase } from "@mustawfi/core-tenancy/server";
import type { Clock, IdGenerator, RandomSource } from "@mustawfi/kernel";

/** What the host hands every module's routes. */
export interface HostContext {
  readonly tenants: TenantDatabase;
  readonly clock: Clock;
  readonly newId: IdGenerator;
  /** Randomness for secrets: session tokens, device credentials, codes. */
  readonly random: RandomSource;
}

/** Every module this server runs. A module missing here fails `modules.test.ts`. */
export const serverModules: readonly ModuleManifest<HostContext>[] = [
  configModule,
  tenancyModule,
  auditModule,
  accessModule,
];

export function createServerRegistry(
  disabled: readonly string[] = [],
): ModuleRegistry<HostContext> {
  return createModuleRegistry(serverModules, { disabled });
}
