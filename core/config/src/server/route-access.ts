/**
 * What a route needs (`core-foundation` rule 17), declared in its options as
 * `config: { access }`:
 * - `public` — no credential: sign-in, device registration (by its code), health, OpenAPI;
 * - `session` — any signed-in user: their own session and account, and reads every user needs;
 * - `device` — a registered device's credential, not revoked (pull, the device's own view);
 * - `deviceEvenRevoked` — a registered device's credential, a revoked one included: push and
 *   the wipe report, the only calls a revoked device may still make (rule 23);
 * - `{ permission }` — a signed-in user whose role holds this unscoped permission.
 *
 * A scoped permission needs a department, which only the handler knows: such a route declares
 * `session` and checks `session.grant.can(permission, department)` itself.
 *
 * The vocabulary sits here, below `core.access` whose guard enforces it, so a module that
 * `core.access` depends on (`core.audit`) can declare its routes too.
 */
export type RouteAccess =
  "public" | "session" | "device" | "deviceEvenRevoked" | { readonly permission: string };

declare module "fastify" {
  interface FastifyContextConfig {
    /** Required on every route; `installRouteAccess` refuses to register one without it. */
    access?: RouteAccess;
    /**
     * The route stays open while the license is read-only or suspended (`core-foundation` rule
     * 5): sign-in, sign-out, the user's own account, push, the wipe report, and export. Any other
     * write is refused then, and a suspended license admits only owners' sessions.
     */
    allowedWhenReadOnly?: true;
  }
}

/** A route's guard declaration, as a module writes it in `config`. */
export interface RouteConfig {
  readonly access: RouteAccess;
  readonly allowedWhenReadOnly?: true;
}

/**
 * Who a guarded request acts for, as a module below `core.access` receives it through its
 * context: the tenant and branch of the session, and its user.
 */
export interface RequestActor {
  readonly tenantId: string;
  readonly branchId: string;
  readonly userId: string;
}
