import { requireSession } from "@mustawfi/core-access/server";
import { accessProblemCodes } from "@mustawfi/core-access/shared";
import { ProblemError } from "@mustawfi/core-config/server";
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
      schema: {
        tags,
        querystring: invoiceListQuerySchema,
        response: { 200: invoiceListSchema, 401: problemDetailsSchema, 403: problemDetailsSchema },
      },
    },
    async (request) => {
      const session = await requireSession(request, context);
      // The skeleton's one permission: the owner (the permission model is `core-foundation`'s).
      if (!session.user.isOwner) {
        throw new ProblemError(accessProblemCodes.ownerRequired, 403, {
          title: "Only the store owner can do this",
        });
      }
      const items = await context.tenants.withTenant(
        { tenantId: session.tenantId, userId: session.user.id },
        (tx) => listInvoices(tx, request.query),
      );
      return { items };
    },
  );
}
