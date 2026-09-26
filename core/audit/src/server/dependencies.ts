import type { RequestActor } from "@mustawfi/core-config/server";
import type { TenantDatabase } from "@mustawfi/core-tenancy/server";
import type { FastifyRequest } from "fastify";
import type { AuditDirectory } from "./entries.ts";

/**
 * The part of the host context `core.audit` routes use. Sessions and the names of users and
 * devices belong to `core.access`, which depends on this module, so the host composes them in.
 */
export interface AuditContext {
  readonly tenants: TenantDatabase;
  /** Who a request guarded by a permission acts for (the guard has authenticated it). */
  readonly requestActor: (request: FastifyRequest) => RequestActor;
  readonly auditDirectory: AuditDirectory;
}
