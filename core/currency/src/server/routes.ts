import { sessionOf } from "@mustawfi/core-access/server";
import { problemDetailsSchema } from "@mustawfi/core-config/shared";
import type { TenantDatabase } from "@mustawfi/core-tenancy/server";
import { type Clock, Decimal, type IdGenerator } from "@mustawfi/kernel";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  CURRENCY_SETTINGS_PERMISSION,
  currencySettingsOverviewSchema,
  exchangeRateSchema,
  RATE_SET_PERMISSION,
  ratesOverviewSchema,
  saveCurrencySettingsRequestSchema,
  setRateRequestSchema,
} from "../shared/index.ts";
import { exchangeRateWire, type RateActor, setExchangeRate } from "./rates.ts";
import { currencySettingsOverview, ratesOverview, saveCurrencySettings } from "./settings.ts";

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

  /** Who acts, from the session, for `withTenant` and the audit. */
  const actorOf = (session: ReturnType<typeof sessionOf>): RateActor => ({
    tenantId: session.tenantId,
    branchId: session.branchId,
    userId: session.user.id,
    ...(session.deviceId === null ? {} : { deviceId: session.deviceId }),
  });

  // The rates screen on a client that is no registered device: a device reads its own database.
  app.get(
    "/rates",
    {
      config: { access: { permission: RATE_SET_PERMISSION } },
      schema: {
        tags,
        response: {
          200: ratesOverviewSchema,
          401: problemDetailsSchema,
          403: problemDetailsSchema,
        },
      },
    },
    async (request) => context.tenants.withTenant(actorOf(sessionOf(request)), ratesOverview),
  );

  app.get(
    "/settings",
    {
      config: { access: { permission: CURRENCY_SETTINGS_PERMISSION } },
      schema: {
        tags,
        response: {
          200: currencySettingsOverviewSchema,
          401: problemDetailsSchema,
          403: problemDetailsSchema,
        },
      },
    },
    async (request) =>
      context.tenants.withTenant(actorOf(sessionOf(request)), currencySettingsOverview),
  );

  app.put(
    "/settings",
    {
      config: { access: { permission: CURRENCY_SETTINGS_PERMISSION } },
      schema: {
        tags,
        body: saveCurrencySettingsRequestSchema,
        response: {
          200: currencySettingsOverviewSchema,
          400: problemDetailsSchema,
          401: problemDetailsSchema,
          403: problemDetailsSchema,
          409: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request) => {
      const actor = actorOf(sessionOf(request));
      return context.tenants.withTenant(actor, (tx) =>
        saveCurrencySettings(tx, actor, request.body, {
          newId: context.newId,
          at: context.clock.now(),
        }),
      );
    },
  );

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
