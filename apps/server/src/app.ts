import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import type { ModuleRegistry } from "@mustawfi/core-config/server";
import { problemDetailsSchema } from "@mustawfi/core-config/shared";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { problemErrorHandler, problemNotFoundHandler } from "./problem-details.ts";

export const OPENAPI_PATH = "/api/v1/openapi.json";

export interface ServerOptions<Context> {
  readonly registry: ModuleRegistry<Context>;
  readonly context: Context;
  readonly logger?: FastifyServerOptions["logger"];
  /**
   * Origins of the native shells' web views (the Windows app is `http://tauri.localhost`),
   * allowed to call the API from another origin (CORS). They authenticate with bearer tokens
   * only (ADR-0022): credentials are not allowed, so the browser's cookie never crosses.
   */
  readonly clientOrigins?: readonly string[];
}

/**
 * The Fastify host (ADR-0014): Zod validates requests and serializes responses, every error is
 * problem details, OpenAPI is generated from the routes' Zod schemas, and each enabled module
 * of the registry is mounted in its own scope under `/api/v1/<module>`.
 */
export async function buildServer<Context>(
  options: ServerOptions<Context>,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(problemErrorHandler);
  app.setNotFoundHandler(problemNotFoundHandler);

  const clientOrigins = new Set(options.clientOrigins ?? []);
  await app.register(cors, {
    origin: (origin, callback) => {
      callback(null, origin !== undefined && clientOrigins.has(origin));
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["authorization", "content-type"],
    credentials: false,
    maxAge: 600,
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: "Mustawfi API", version: "1" },
      components: {},
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  const api = app.withTypeProvider<ZodTypeProvider>();
  api.get(
    "/api/v1/health",
    {
      schema: {
        tags: ["host"],
        response: { 200: z.object({ status: z.literal("ok") }), 500: problemDetailsSchema },
      },
    },
    () => ({ status: "ok" as const }),
  );
  api.get(OPENAPI_PATH, { schema: { hide: true } }, () => app.swagger());

  await options.registry.mount(app, options.context);
  return app;
}
