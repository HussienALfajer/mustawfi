import { sessionOf } from "@mustawfi/core-access/server";
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
      config: { access: { permission: "inventory.products.manage" } },
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
      const session = sessionOf(request);
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
      config: { access: { permission: "inventory.products.view" } },
      schema: {
        tags,
        querystring: productListQuerySchema,
        response: { 200: productPageSchema, 401: problemDetailsSchema, 403: problemDetailsSchema },
      },
    },
    async (request) => {
      const session = sessionOf(request);
      return context.tenants.withTenant(
        { tenantId: session.tenantId, userId: session.user.id },
        (tx) => listProducts(tx, request.query),
      );
    },
  );
}
