import { installRouteAccess, routeAccessTable } from "@mustawfi/core-access/server";
import {
  createModuleRegistry,
  defineModule,
  ProblemError,
  type ModuleManifest,
} from "@mustawfi/core-config/server";
import { problemDetailsSchema } from "@mustawfi/core-config/shared";
import type { TenantDatabase } from "@mustawfi/core-tenancy/server";
import { systemClock } from "@mustawfi/kernel";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildServer, OPENAPI_PATH } from "./app.ts";
import { PROBLEM_CONTENT_TYPE } from "./problem-details.ts";

interface FixtureContext {
  readonly taken: ReadonlySet<string>;
}

const widgetSchema = z.object({ id: z.uuid(), name: z.string() }).meta({ id: "Widget" });

/** A module the way real ones will look: Zod contracts, a business refusal, a failure. */
const fixtureModule: ModuleManifest<FixtureContext> = defineModule<FixtureContext>({
  id: "fixture",
  dependsOn: [],
  routes(scope, context) {
    const app = scope.withTypeProvider<ZodTypeProvider>();
    app.post(
      "/widgets",
      {
        config: { access: "public" },
        schema: {
          body: z.object({ name: z.string().min(1).max(40) }),
          response: { 201: widgetSchema, 409: problemDetailsSchema },
        },
      },
      async (request, reply) => {
        if (context.taken.has(request.body.name)) {
          throw new ProblemError("fixture.widget.nameTaken", 409, {
            title: "Name taken",
            detail: `a widget named ${request.body.name} exists`,
          });
        }
        return reply
          .status(201)
          .send({ id: "0199a5c4-7b1e-7000-8000-000000000001", name: request.body.name });
      },
    );
    app.get("/explode", { config: { access: "public" } }, () => {
      throw new Error("secret connection string in a message");
    });
    app.get(
      "/badly-shaped",
      { config: { access: "public" }, schema: { response: { 200: widgetSchema } } },
      () => ({
        id: "not a uuid",
        name: "x",
      }),
    );
  },
});

const disabledModule = defineModule<FixtureContext>({
  id: "disabled",
  dependsOn: [],
  routes(app) {
    app.get("/here", { config: { access: "public" } }, () => ({ here: true }));
  },
});

let app: FastifyInstance;

/** Public routes only: the guard never reaches the database here. */
const noDatabase = new Proxy({} as TenantDatabase, {
  get() {
    throw new Error("the host tests use no database");
  },
});

beforeAll(async () => {
  const registry = createModuleRegistry([fixtureModule, disabledModule], {
    disabled: ["disabled"],
  });
  app = await buildServer({
    registry,
    context: { taken: new Set(["taken"]) },
    guard: (server) => {
      installRouteAccess(server, {
        tenants: noDatabase,
        clock: systemClock,
        permissionCatalogue: registry.permissions,
      });
    },
    clientOrigins: ["http://tauri.localhost"],
  });
});

afterAll(() => app.close());

function expectProblem(
  response: { statusCode: number; headers: Record<string, unknown>; json(): unknown },
  status: number,
  code: string,
) {
  expect(response.statusCode).toBe(status);
  expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
  const body = problemDetailsSchema.parse(response.json());
  expect(body).toMatchObject({ status, code });
  return body;
}

describe("server host", () => {
  it("answers health", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("mounts an enabled module under its prefix and validates with its Zod contract", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/fixture/widgets",
      payload: { name: "bolt" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: "bolt" });
  });

  it("puts every route it adds behind the guard, health and OpenAPI as public", () => {
    const routes = routeAccessTable(app).filter((route) => route.method !== "HEAD");
    expect(routes.map((r) => `${r.method} ${r.url} ${JSON.stringify(r.access)}`)).toEqual([
      'GET /api/v1/health "public"',
      'GET /api/v1/openapi.json "public"',
      'POST /api/v1/fixture/widgets "public"',
      'GET /api/v1/fixture/explode "public"',
      'GET /api/v1/fixture/badly-shaped "public"',
    ]);
  });

  it("does not mount a disabled module", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/disabled/here" });
    expectProblem(response, 404, "core.route.notFound");
  });
});

describe("cross-origin calls (CORS)", () => {
  it("lets the Windows app's origin call with a bearer token, never with cookies", async () => {
    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/fixture/widgets",
      headers: {
        origin: "http://tauri.localhost",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("http://tauri.localhost");
    expect(preflight.headers["access-control-allow-headers"]).toBe("authorization, content-type");
    expect(preflight.headers["access-control-allow-credentials"]).toBeUndefined();
    const call = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { origin: "http://tauri.localhost" },
    });
    expect(call.headers["access-control-allow-origin"]).toBe("http://tauri.localhost");
  });

  it("gives any other origin no CORS headers", async () => {
    for (const origin of ["https://evil.example", "http://localhost:5173"]) {
      const preflight = await app.inject({
        method: "OPTIONS",
        url: "/api/v1/fixture/widgets",
        headers: { origin, "access-control-request-method": "POST" },
      });
      expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
      const call = await app.inject({
        method: "GET",
        url: "/api/v1/health",
        headers: { origin },
      });
      expect(call.headers["access-control-allow-origin"]).toBeUndefined();
    }
  });
});

describe("problem details", () => {
  it("renders a business refusal with its own code and status", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/fixture/widgets",
      payload: { name: "taken" },
    });
    expect(expectProblem(response, 409, "fixture.widget.nameTaken")).toEqual({
      type: "about:blank",
      title: "Name taken",
      status: 409,
      code: "fixture.widget.nameTaken",
      detail: "a widget named taken exists",
      instance: "/api/v1/fixture/widgets",
    });
  });

  it("renders an invalid request as core.request.invalid with the failing fields", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/fixture/widgets",
      payload: { name: "" },
    });
    const problem = expectProblem(response, 400, "core.request.invalid");
    expect(problem.errors?.map((e) => e.path)).toEqual(["body/name"]);
  });

  it("renders a malformed body as core.request.rejected", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/fixture/widgets",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expectProblem(response, 400, "core.request.rejected");
  });

  it("renders an unknown route as core.route.notFound", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/nowhere" });
    expectProblem(response, 404, "core.route.notFound");
  });

  it("renders an unexpected failure as a 500 that reveals nothing", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/fixture/explode" });
    const problem = expectProblem(response, 500, "core.server.internal");
    expect(JSON.stringify(problem)).not.toContain("secret");
  });

  it("renders a response that breaks its own contract as a 500", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/fixture/badly-shaped" });
    expectProblem(response, 500, "core.server.internal");
  });
});

describe("OpenAPI", () => {
  it("is generated from the routes' Zod contracts", async () => {
    const response = await app.inject({ method: "GET", url: OPENAPI_PATH });
    expect(response.statusCode).toBe(200);
    const document = response.json<{
      openapi: string;
      paths: Record<string, Record<string, Record<string, unknown>>>;
      components: { schemas: Record<string, unknown> };
    }>();
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths).sort()).toEqual([
      "/api/v1/fixture/badly-shaped",
      "/api/v1/fixture/explode",
      "/api/v1/fixture/widgets",
      "/api/v1/health",
    ]);
    expect(document.paths["/api/v1/fixture/widgets"]?.["post"]).toMatchObject({
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { name: { type: "string", minLength: 1, maxLength: 40 } },
              required: ["name"],
            },
          },
        },
      },
      responses: {
        "201": {
          content: { "application/json": { schema: { $ref: "#/components/schemas/Widget" } } },
        },
        "409": {
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ProblemDetails" } },
          },
        },
      },
    });
    expect(document.components.schemas).toHaveProperty("Widget");
    expect(document.components.schemas).toHaveProperty("ProblemDetails");
  });
});
