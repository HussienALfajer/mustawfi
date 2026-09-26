import { ProblemError } from "@mustawfi/core-config/server";
import type { PermissionCatalogue } from "@mustawfi/core-config/shared";
import type { TenantDatabase } from "@mustawfi/core-tenancy/server";
import { systemClock } from "@mustawfi/kernel";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { accessProblemCodes } from "../shared/index.ts";
import {
  installRouteAccess,
  type RouteAccess,
  routeAccessTable,
  sessionOf,
} from "./route-access.ts";

const catalogue: PermissionCatalogue = {
  permissions: new Map([
    ["audit.view", { id: "audit.view", moduleId: "core.audit", scoped: false, grants: [] }],
    [
      "sales.invoice.create",
      { id: "sales.invoice.create", moduleId: "sales", scoped: true, grants: [] },
    ],
  ]),
  limits: new Map(),
};

/** Requests without credentials never reach the database. */
const noDatabase = new Proxy({} as TenantDatabase, {
  get() {
    throw new Error("these requests carry no credential");
  },
});

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function guarded(): FastifyInstance {
  const server = Fastify();
  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof ProblemError) {
      return reply.status(error.status).send({ code: error.code });
    }
    return reply.status(500).send({ message: String(error) });
  });
  installRouteAccess(server, {
    tenants: noDatabase,
    clock: systemClock,
    permissionCatalogue: catalogue,
  });
  app = server;
  return server;
}

function route(server: FastifyInstance, access: RouteAccess | undefined, url = "/thing") {
  server.post(url, access === undefined ? {} : { config: { access } }, (request) => {
    if (access === "session" || typeof access === "object") sessionOf(request);
    return { ok: true };
  });
}

describe("installRouteAccess (core-foundation rule 17)", () => {
  it("refuses to register a route that declares no access", () => {
    expect(() => {
      route(guarded(), undefined);
    }).toThrow("route POST /thing declares no access");
  });

  it("refuses a permission no module declares", () => {
    expect(() => {
      route(guarded(), { permission: "audit.read" });
    }).toThrow("route POST /thing needs audit.read, which no module declares");
  });

  it("refuses a scoped permission, which only the handler can check in its department", () => {
    expect(() => {
      route(guarded(), { permission: "sales.invoice.create" });
    }).toThrow(/scoped sales\.invoice\.create/);
  });

  it("refuses an unknown kind of access", () => {
    expect(() => {
      route(guarded(), "anyone" as never);
    }).toThrow(/unknown access/);
  });

  it("lists every route with what it needs, scopes included", async () => {
    const server = guarded();
    route(server, "public", "/open");
    server.post(
      "/sign-out",
      { config: { access: "session", allowedWhenReadOnly: true } },
      () => ({}),
    );
    await server.register(
      (scope, _options, done) => {
        route(scope, { permission: "audit.view" }, "/entries");
        done();
      },
      { prefix: "/api/v1/audit" },
    );
    expect(routeAccessTable(server)).toEqual([
      { method: "POST", url: "/open", access: "public", allowedWhenReadOnly: false },
      { method: "POST", url: "/sign-out", access: "session", allowedWhenReadOnly: true },
      {
        method: "POST",
        url: "/api/v1/audit/entries",
        access: { permission: "audit.view" },
        allowedWhenReadOnly: false,
      },
    ]);
  });

  it("refuses allowedWhenReadOnly other than true", () => {
    expect(() => {
      guarded().post(
        "/thing",
        { config: { access: "session", allowedWhenReadOnly: false as never } },
        () => ({}),
      );
    }).toThrow(/allowedWhenReadOnly other than true/);
  });

  it("answers a public route without credentials", async () => {
    const server = guarded();
    route(server, "public");
    expect((await server.inject({ method: "POST", url: "/thing" })).json()).toEqual({ ok: true });
  });

  it.each<[RouteAccess, string]>([
    ["session", accessProblemCodes.sessionRequired],
    [{ permission: "audit.view" }, accessProblemCodes.sessionRequired],
    ["device", accessProblemCodes.deviceRequired],
  ])("refuses %j without its credential, before reading the body", async (access, code) => {
    const server = guarded();
    route(server, access);
    const response = await server.inject({
      method: "POST",
      url: "/thing",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code });
  });

  it("does not guard a not-found answer", async () => {
    const server = guarded();
    expect((await server.inject({ method: "GET", url: "/nowhere" })).statusCode).toBe(404);
  });

  it("refuses a request to a route registered before the guard, which declares nothing", async () => {
    const server = Fastify();
    server.setErrorHandler((error, _request, reply) =>
      reply.status(error instanceof ProblemError ? error.status : 500).send({}),
    );
    server.get("/early", () => ({ ok: true }));
    installRouteAccess(server, {
      tenants: noDatabase,
      clock: systemClock,
      permissionCatalogue: catalogue,
    });
    app = server;
    expect((await server.inject({ method: "GET", url: "/early" })).statusCode).toBe(403);
  });
});
