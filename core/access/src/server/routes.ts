import { ProblemError } from "@mustawfi/core-config/server";
import { problemDetailsSchema } from "@mustawfi/core-config/shared";
import { currentTenant } from "@mustawfi/core-tenancy/server";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  accessProblemCodes,
  currentDeviceSchema,
  currentSessionSchema,
  loginRequestSchema,
  loginResponseSchema,
  registerDeviceRequestSchema,
  registeredDeviceSchema,
  registrationCodeResponseSchema,
} from "../shared/index.ts";
import type { AccessContext } from "./dependencies.ts";
import {
  issueRegistrationCode,
  registerDevice,
  registrationFailed,
  requireDevice,
} from "./devices.ts";
import { logIn } from "./login.ts";
import { requireSession, revokeSession } from "./sessions.ts";

const tags = ["access"];

/** `core.access` routes, under `/api/v1/access`. */
export function accessRoutes(scope: FastifyInstance, context: AccessContext): void {
  const app = scope.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/login",
    {
      schema: {
        tags,
        body: loginRequestSchema,
        response: { 200: loginResponseSchema, 401: problemDetailsSchema },
      },
    },
    async (request) => {
      const loggedIn = await logIn(context.tenants, request.body, context);
      return { ...loggedIn, expiresAt: loggedIn.expiresAt.toISOString() };
    },
  );

  app.post(
    "/logout",
    { schema: { tags, response: { 204: z.null(), 401: problemDetailsSchema } } },
    async (request, reply) => {
      const session = await requireSession(request, context);
      await revokeSession(context.tenants, session, context);
      return reply.status(204).send(null);
    },
  );

  app.get(
    "/session",
    { schema: { tags, response: { 200: currentSessionSchema, 401: problemDetailsSchema } } },
    async (request) => {
      const session = await requireSession(request, context);
      return {
        tenantId: session.tenantId,
        expiresAt: session.expiresAt.toISOString(),
        user: session.user,
      };
    },
  );

  app.post(
    "/registration-codes",
    {
      schema: {
        tags,
        response: {
          201: registrationCodeResponseSchema,
          401: problemDetailsSchema,
          403: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const session = await requireSession(request, context);
      if (!session.user.isOwner) {
        throw new ProblemError(accessProblemCodes.ownerRequired, 403, {
          title: "Only the store owner can do this",
        });
      }
      const issued = await context.tenants.withTenant(
        { tenantId: session.tenantId, userId: session.user.id },
        async (tx) => {
          const tenant = await currentTenant(tx);
          if (tenant === undefined) throw new Error("session of a missing tenant");
          const code = await issueRegistrationCode(
            tx,
            { tenantId: session.tenantId, branchId: session.branchId, userId: session.user.id },
            context,
          );
          return { code: code.code, storeCode: tenant.storeCode, expiresAt: code.expiresAt };
        },
      );
      return reply.status(201).send({ ...issued, expiresAt: issued.expiresAt.toISOString() });
    },
  );

  app.post(
    "/devices",
    {
      schema: {
        tags,
        body: registerDeviceRequestSchema,
        response: {
          201: registeredDeviceSchema,
          401: problemDetailsSchema,
          409: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const { storeCode, registrationCode, type, name } = request.body;
      const tenantId = await context.tenants.resolveStoreCode(storeCode);
      if (tenantId === undefined) throw registrationFailed();
      const registered = await context.tenants.withTenant({ tenantId }, (tx) =>
        registerDevice(tx, { tenantId, registrationCode, type, name }, context),
      );
      return reply.status(201).send(registered);
    },
  );

  app.get(
    "/devices/current",
    { schema: { tags, response: { 200: currentDeviceSchema, 401: problemDetailsSchema } } },
    async (request) => {
      const device = await requireDevice(request, context);
      return {
        deviceId: device.deviceId,
        tenantId: device.tenantId,
        prefix: device.prefix,
        type: device.type,
        name: device.name,
      };
    },
  );
}
