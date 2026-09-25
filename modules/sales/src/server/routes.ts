import { sessionOf } from "@mustawfi/core-access/server";
import { problemDetailsSchema } from "@mustawfi/core-config/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { invoiceListQuerySchema, invoiceListSchema } from "../shared/index.ts";
import type { SalesContext } from "./dependencies.ts";
import { listInvoices } from "./invoice-list.ts";

const tags = ["sales"];

/** `sales` routes, under `/api/v1/sales`. Every query runs under the session's tenant. */
export function salesRoutes(scope: FastifyInstance, context: SalesContext): void {
  const app = scope.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/invoices",
    {
      config: { access: { permission: "sales.invoices.view" } },
      schema: {
        tags,
        querystring: invoiceListQuerySchema,
        response: { 200: invoiceListSchema, 401: problemDetailsSchema, 403: problemDetailsSchema },
      },
    },
    async (request) => {
      const session = sessionOf(request);
      const items = await context.tenants.withTenant(
        { tenantId: session.tenantId, userId: session.user.id },
        (tx) => listInvoices(tx, request.query),
      );
      return { items };
    },
  );
}
