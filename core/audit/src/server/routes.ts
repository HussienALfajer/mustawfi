import { ProblemError, type RouteConfig } from "@mustawfi/core-config/server";
import { problemDetailsSchema } from "@mustawfi/core-config/shared";
import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  auditEntryViewSchema,
  auditFacetsSchema,
  auditPageSchema,
  auditProblemCodes,
  auditQuerySchema,
} from "../shared/index.ts";
import type { AuditContext } from "./dependencies.ts";
import { auditActions, auditEntry, listAuditEntries } from "./entries.ts";

const tags = ["audit"];

/** The log is read by owners and holders of `audit.view` only (`core-foundation` rule 35). */
const view: RouteConfig = { access: { permission: "audit.view" } };

const refusals = {
  400: problemDetailsSchema,
  401: problemDetailsSchema,
  403: problemDetailsSchema,
};

/**
 * `core.audit` routes, under `/api/v1/audit`: reading the log. Nothing here writes, changes, or
 * removes an entry — the log has no such route (rule 35).
 */
export function auditRoutes(scope: FastifyInstance, context: AuditContext): void {
  const app = scope.withTypeProvider<ZodTypeProvider>();

  function asReader<T>(
    request: FastifyRequest,
    fn: (tx: TenantTransaction) => Promise<T>,
  ): Promise<T> {
    const actor = context.requestActor(request);
    return context.tenants.withTenant({ tenantId: actor.tenantId, userId: actor.userId }, fn);
  }

  app.get(
    "/entries",
    {
      config: view,
      schema: {
        tags,
        querystring: auditQuerySchema,
        response: { 200: auditPageSchema, ...refusals },
      },
    },
    (request) =>
      asReader(request, (tx) => listAuditEntries(tx, request.query, context.auditDirectory)),
  );

  app.get(
    "/entries/:id",
    {
      config: view,
      schema: {
        tags,
        params: z.object({ id: z.uuid() }),
        response: { 200: auditEntryViewSchema, 404: problemDetailsSchema, ...refusals },
      },
    },
    (request) =>
      asReader(request, async (tx) => {
        const entry = await auditEntry(tx, request.params.id, context.auditDirectory);
        if (entry === undefined) {
          throw new ProblemError(auditProblemCodes.entryNotFound, 404, {
            title: "The audit log has no such entry",
          });
        }
        return entry;
      }),
  );

  app.get(
    "/facets",
    {
      config: view,
      schema: { tags, response: { 200: auditFacetsSchema, ...refusals } },
    },
    (request) =>
      asReader(request, async (tx) => {
        const users = await context.auditDirectory.users(tx);
        const devices = await context.auditDirectory.devices(tx);
        const actions = await auditActions(tx);
        return { users: [...users], devices: [...devices], actions };
      }),
  );
}
