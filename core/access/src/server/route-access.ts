import { ProblemError } from "@mustawfi/core-config/server";
import type { PermissionCatalogue } from "@mustawfi/core-config/shared";
import type { TenantDatabase } from "@mustawfi/core-tenancy/server";
import type { Clock } from "@mustawfi/kernel";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { accessProblemCodes } from "../shared/index.ts";
import { type Device, requireDevice } from "./devices.ts";
import { requireSession, type Session } from "./sessions.ts";

/**
 * What a route needs (`core-foundation` rule 17), declared in its options as
 * `config: { access }`:
 * - `public` — no credential: sign-in, device registration (by its code), health, OpenAPI;
 * - `session` — any signed-in user: their own session and account, and reads every user needs;
 * - `device` — a registered device's credential (sync);
 * - `{ permission }` — a signed-in user whose role holds this unscoped permission.
 *
 * A scoped permission needs a department, which only the handler knows: such a route declares
 * `session` and checks `session.grant.can(permission, department)` itself.
 */
export type RouteAccess = "public" | "session" | "device" | { readonly permission: string };

declare module "fastify" {
  interface FastifyContextConfig {
    /** Required on every route; `installRouteAccess` refuses to register one without it. */
    access?: RouteAccess;
  }
}

/** A registered route and what it needs. */
export interface RouteAccessEntry {
  readonly method: string;
  readonly url: string;
  readonly access: RouteAccess;
}

/** What the guard needs from the host. */
export interface RouteAccessContext {
  readonly tenants: TenantDatabase;
  readonly clock: Clock;
  readonly permissionCatalogue: PermissionCatalogue;
}

const tables = new WeakMap<FastifyInstance, RouteAccessEntry[]>();
const sessions = new WeakMap<FastifyRequest, Session>();
const devices = new WeakMap<FastifyRequest, Device>();

/** 403 `access.permission.denied`. */
export function permissionDenied(): ProblemError {
  return new ProblemError(accessProblemCodes.permissionDenied, 403, {
    title: "Your role does not allow this",
  });
}

/**
 * Guards every route registered on `app` after this call (`core-foundation` rule 17). At
 * registration it refuses — throws, so the server does not start — a route without an
 * `access` declaration, or naming a permission no module declares or a scoped one. On each
 * request, before the body is read, it authenticates the session or device the route needs and
 * checks the permission: 401 without a valid credential, 403 `access.permission.denied`
 * without the permission. A route registered before the guard (the CORS preflight) declares
 * nothing and is refused unless it answers by itself.
 */
export function installRouteAccess(app: FastifyInstance, context: RouteAccessContext): void {
  const table: RouteAccessEntry[] = [];
  tables.set(app, table);

  app.addHook("onRoute", (route) => {
    const methods = [route.method].flat();
    const access = route.config?.access;
    const name = `${methods.join(",")} ${route.url}`;
    if (access === undefined) throw new Error(`route ${name} declares no access`);
    if (typeof access === "object") {
      const declared = context.permissionCatalogue.permissions.get(access.permission);
      if (declared === undefined) {
        throw new Error(`route ${name} needs ${access.permission}, which no module declares`);
      }
      if (declared.scoped) {
        throw new Error(
          `route ${name} needs the scoped ${access.permission}: declare "session" and check it in the handler`,
        );
      }
    } else if (!["public", "session", "device"].includes(access)) {
      throw new Error(`route ${name} declares unknown access ${JSON.stringify(access)}`);
    }
    for (const method of methods) table.push({ method, url: route.url, access });
  });

  app.addHook("onRequest", async (request) => {
    if (request.is404) return;
    const access = request.routeOptions.config.access;
    if (access === undefined) throw permissionDenied();
    if (access === "public") return;
    if (access === "device") {
      devices.set(request, await requireDevice(request, context));
      return;
    }
    const session = await requireSession(request, context);
    if (typeof access === "object" && !session.grant.can(access.permission)) {
      throw permissionDenied();
    }
    sessions.set(request, session);
  });
}

/** The routes registered on `app` since `installRouteAccess`, with what each needs. */
export function routeAccessTable(app: FastifyInstance): readonly RouteAccessEntry[] {
  const table = tables.get(app);
  if (table === undefined) throw new Error("installRouteAccess was not called on this server");
  return table;
}

/** The session the guard authenticated for a `session` or permission route. */
export function sessionOf(request: FastifyRequest): Session {
  const session = sessions.get(request);
  if (session === undefined) {
    throw new Error(`${request.method} ${request.url} reads a session its route does not declare`);
  }
  return session;
}

/** The device the guard authenticated for a `device` route. */
export function deviceOf(request: FastifyRequest): Device {
  const device = devices.get(request);
  if (device === undefined) {
    throw new Error(`${request.method} ${request.url} reads a device its route does not declare`);
  }
  return device;
}
