import { ProblemError, type RouteAccess } from "@mustawfi/core-config/server";
import type { PermissionCatalogue } from "@mustawfi/core-config/shared";
import {
  currentLicenseStatus,
  licenseReadOnly,
  licenseSuspended,
  type TenantDatabase,
} from "@mustawfi/core-tenancy/server";
import { isReadOnlyState, type LicenseState } from "@mustawfi/core-tenancy/shared";
import type { Clock } from "@mustawfi/kernel";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { accessProblemCodes } from "../shared/index.ts";
import { type Device, requireDevice } from "./devices.ts";
import { requireSession, SAFE_METHODS, type Session } from "./sessions.ts";

// The declaration vocabulary (`RouteAccess`, `RouteConfig`, and `config.access` on Fastify's
// route options) lives in `core.config`, so modules below this one declare routes too.
export type { RouteAccess, RouteConfig } from "@mustawfi/core-config/server";

/** A registered route and what it needs. */
export interface RouteAccessEntry {
  readonly method: string;
  readonly url: string;
  readonly access: RouteAccess;
  /** Open while the license is read-only or suspended (rule 5). */
  readonly allowedWhenReadOnly: boolean;
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
 *
 * It also applies the license's lifecycle, computed with the server clock (rule 5): while the
 * license is suspended, a non-owner's session gets 403 `tenancy.license.suspended` everywhere;
 * while it is read-only or suspended, every write gets 403 `tenancy.license.readOnly` —
 * except on routes marked `allowedWhenReadOnly`. Public routes carry no tenant here: one that
 * writes checks the license in its handler (`requireWritableLicense`).
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
    } else if (!["public", "session", "device", "deviceEvenRevoked"].includes(access)) {
      throw new Error(`route ${name} declares unknown access ${JSON.stringify(access)}`);
    }
    if (![undefined, true].includes(route.config?.allowedWhenReadOnly)) {
      throw new Error(`route ${name} declares allowedWhenReadOnly other than true`);
    }
    const allowedWhenReadOnly = route.config?.allowedWhenReadOnly === true;
    for (const method of methods) {
      table.push({ method, url: route.url, access, allowedWhenReadOnly });
    }
  });

  app.addHook("onRequest", async (request) => {
    if (request.is404) return;
    const access = request.routeOptions.config.access;
    if (access === undefined) throw permissionDenied();
    if (access === "public") return;
    const gated = request.routeOptions.config.allowedWhenReadOnly !== true;
    const write = !SAFE_METHODS.has(request.method);
    if (access === "device" || access === "deviceEvenRevoked") {
      const allowRevoked = access === "deviceEvenRevoked";
      const device = await requireDevice(request, context, { allowRevoked });
      if (gated && write && isReadOnlyState(await licenseStateOf(device.tenantId))) {
        throw licenseReadOnly();
      }
      devices.set(request, device);
      return;
    }
    const session = await requireSession(request, context);
    // Read once, and only when it can refuse: owners read in every state.
    let state: LicenseState | undefined;
    if (gated && (write || !session.user.role.isOwner)) {
      state = await licenseStateOf(session.tenantId);
    }
    // A non-owner learns the store is suspended before anything about their role.
    if (state === "suspended" && !session.user.role.isOwner) throw licenseSuspended();
    if (typeof access === "object" && !session.grant.can(access.permission)) {
      throw permissionDenied();
    }
    if (write && state !== undefined && isReadOnlyState(state)) throw licenseReadOnly();
    sessions.set(request, session);
  });

  /** The tenant's license state now, by the server clock (rule 5). */
  function licenseStateOf(tenantId: string): Promise<LicenseState> {
    return context.tenants.withTenant({ tenantId }, async (tx) => {
      const { state } = await currentLicenseStatus(tx, context.clock.now());
      return state;
    });
  }
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

/** The device the guard authenticated for a `device` or `deviceEvenRevoked` route. */
export function deviceOf(request: FastifyRequest): Device {
  const device = devices.get(request);
  if (device === undefined) {
    throw new Error(`${request.method} ${request.url} reads a device its route does not declare`);
  }
  return device;
}
