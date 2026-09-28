import { sessionOf } from "@mustawfi/core-access/server";
import { problemDetailsSchema } from "@mustawfi/core-config/shared";
import type { TenantDatabase } from "@mustawfi/core-tenancy/server";
import { type Clock, Decimal, type IdGenerator } from "@mustawfi/kernel";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { exchangeRateSchema, RATE_SET_PERMISSION, setRateRequestSchema } from "../shared/index.ts";
import { exchangeRateWire, setExchangeRate } from "./rates.ts";

/** The part of the host context `core.currency` routes use. */
export interface CurrencyContext {
  readonly tenants: TenantDatabase;
  readonly clock: Clock;
  readonly newId: IdGenerator;
}

const tags = ["currency"];

/** `core.currency` routes, under `/api/v1/currency`. Every query runs under the session's tenant. */
export function currencyRoutes(scope: FastifyInstance, context: CurrencyContext): void {
  const app = scope.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/rates",
    {
      config: { access: { permission: RATE_SET_PERMISSION } },
      schema: {
        tags,
        body: setRateRequestSchema,
        response: {
          201: exchangeRateSchema,
          400: problemDetailsSchema,
          401: problemDetailsSchema,
          403: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const session = sessionOf(request);
      const recorded = await context.tenants.withTenant(
        {
          tenantId: session.tenantId,
          userId: session.user.id,
          ...(session.deviceId === null ? {} : { deviceId: session.deviceId }),
        },
        (tx) =>
          setExchangeRate(
            tx,
            {
              tenantId: session.tenantId,
              branchId: session.branchId,
              userId: session.user.id,
              ...(session.deviceId === null ? {} : { deviceId: session.deviceId }),
            },
            {
              id: context.newId(),
              unitCurrency: request.body.unitCurrency,
              quoteCurrency: request.body.quoteCurrency,
              rate: Decimal.of(request.body.rate),
              confirmed: request.body.confirmed,
              at: context.clock.now(),
            },
            context,
          ),
      );
      return reply.status(201).send(exchangeRateWire(recorded.rate));
    },
  );
}
