import { deviceOf, recordDeviceSync } from "@mustawfi/core-access/server";
import { problemDetailsSchema } from "@mustawfi/core-config/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  pullQuerySchema,
  pullResponseSchema,
  pushRequestSchema,
  pushResponseSchema,
} from "../shared/index.ts";
import { readChanges } from "./changes.ts";
import type { SyncContext } from "./dependencies.ts";
import { pushOperations } from "./push.ts";

const tags = ["sync"];

/**
 * `core.sync` routes, under `/api/v1/sync` (ADR-0020). Both authenticate as the device, with
 * its credential; each pushed operation names the user who performed it. A revoked device may
 * still push, and nothing else (`core-foundation` rule 23). Each records the server's time
 * of the device's last sync.
 */
export function syncRoutes(scope: FastifyInstance, context: SyncContext): void {
  const app = scope.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/push",
    {
      config: { access: "deviceEvenRevoked" },
      schema: {
        tags,
        body: pushRequestSchema,
        response: { 200: pushResponseSchema, 401: problemDetailsSchema, 422: problemDetailsSchema },
      },
    },
    async (request) => {
      const device = deviceOf(request);
      await recordDeviceSync(context.tenants, device, context.clock.now());
      return pushOperations(context.tenants, device, request.body.operations, {
        clock: context.clock,
        newId: context.newId,
        operations: context.syncOperations,
      });
    },
  );

  app.get(
    "/pull",
    {
      config: { access: "device" },
      schema: {
        tags,
        querystring: pullQuerySchema,
        response: { 200: pullResponseSchema, 401: problemDetailsSchema },
      },
    },
    async (request) => {
      const device = deviceOf(request);
      await recordDeviceSync(context.tenants, device, context.clock.now());
      return context.tenants.withTenant(
        { tenantId: device.tenantId, deviceId: device.deviceId },
        (tx) => readChanges(tx, request.query),
      );
    },
  );
}
