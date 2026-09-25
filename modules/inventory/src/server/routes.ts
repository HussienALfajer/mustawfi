import { requireSession } from "@mustawfi/core-access/server";
import { accessProblemCodes } from "@mustawfi/core-access/shared";
import { ProblemError } from "@mustawfi/core-config/server";
import { problemDetailsSchema } from "@mustawfi/core-config/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  newProductSchema,
  productListQuerySchema,
  productPageSchema,
  productSchema,
} from "../shared/index.ts";
import type { InventoryContext } from "./dependencies.ts";
import { createProduct, listProducts } from "./products.ts";

const tags = ["inventory"];

/** `inventory` routes, under `/api/v1/inventory`. Every query runs under the session's tenant. */
export function inventoryRoutes(scope: FastifyInstance, context: InventoryContext): void {
  const app = scope.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/products",
    {
      schema: {
        tags,
        body: newProductSchema,
        response: {
          201: productSchema,
          401: problemDetailsSchema,
          403: problemDetailsSchema,
          409: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const session = await requireSession(request, context);
      // The skeleton's one permission: the owner (the permission model is `core-foundation`'s).
      if (!session.user.isOwner) {
        throw new ProblemError(accessProblemCodes.ownerRequired, 403, {
          title: "Only the store owner can do this",
        });
      }
      const product = await context.tenants.withTenant(
        { tenantId: session.tenantId, userId: session.user.id },
        (tx) =>
          createProduct(
            tx,
            {
              ...request.body,
              id: context.newId(),
              tenantId: session.tenantId,
              branchId: session.branchId,
              createdAt: context.clock.now(),
              createdBy: session.user.id,
              ...(session.deviceId === null ? {} : { deviceId: session.deviceId }),
            },
            context,
          ),
      );
      return reply.status(201).send(product);
    },
  );

  app.get(
    "/products",
    {
      schema: {
        tags,
        querystring: productListQuerySchema,
        response: { 200: productPageSchema, 401: problemDetailsSchema },
      },
    },
    async (request) => {
      const session = await requireSession(request, context);
      return context.tenants.withTenant(
        { tenantId: session.tenantId, userId: session.user.id },
        (tx) => listProducts(tx, request.query),
      );
    },
  );
}
