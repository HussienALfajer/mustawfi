import { type PermissionCatalogue, problemDetailsSchema } from "@mustawfi/core-config/shared";
import { currentTenant, type TenantTransaction } from "@mustawfi/core-tenancy/server";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  changeOwnPasswordRequestSchema,
  changeOwnPinRequestSchema,
  currentDeviceSchema,
  currentSessionSchema,
  deactivateUserRequestSchema,
  deviceViewSchema,
  newUserRequestSchema,
  permissionCatalogueSchema,
  roleRequestSchema,
  roleViewSchema,
  setPasswordRequestSchema,
  setPinRequestSchema,
  userChangeRequestSchema,
  userViewSchema,
  loginRequestSchema,
  loginResponseSchema,
  passwordResetRequestSchema,
  pinLoginRequestSchema,
  registerDeviceRequestSchema,
  registeredDeviceSchema,
  registrationCodeResponseSchema,
  revokeDeviceRequestSchema,
} from "../shared/index.ts";
import type { Manager } from "./actor.ts";
import type { AccessContext } from "./dependencies.ts";
import {
  issueRegistrationCode,
  listDevices,
  registerDevice,
  registrationFailed,
  reportDeviceWiped,
  revokeDevice,
} from "./devices.ts";
import { type LoggedIn, logIn, logInWithPin, type SignInSource } from "./login.ts";
import { resetPasswordWithCode } from "./reset-codes.ts";
import { archiveRole, copyRole, editRole, listRoles } from "./roles.ts";
import { deviceOf, type RouteAccess, sessionOf } from "./route-access.ts";
import {
  CLEARED_SESSION_COOKIE,
  crossOriginRefused,
  deviceCredentialOf,
  isSameOrigin,
  revokeSession,
  type Session,
  sessionCookie,
} from "./sessions.ts";
import { signInThrottles } from "./throttle.ts";
import {
  addUser,
  changeOwnPassword,
  changeOwnPin,
  changeUser,
  deactivateUser,
  listUsers,
  reactivateUser,
  setUserPassword,
  setUserPin,
} from "./users.ts";

const tags = ["access"];

const idParamsSchema = z.object({ id: z.uuid() });

const refusals = {
  401: problemDetailsSchema,
  403: problemDetailsSchema,
  404: problemDetailsSchema,
  409: problemDetailsSchema,
  422: problemDetailsSchema,
};

const viewUsers: { readonly access: RouteAccess } = {
  access: { permission: "access.users.view" },
};
const manageUsers: { readonly access: RouteAccess } = {
  access: { permission: "access.users.manage" },
};
const manageRoles: { readonly access: RouteAccess } = {
  access: { permission: "access.roles.manage" },
};
const manageDevices: { readonly access: RouteAccess } = {
  access: { permission: "access.devices.manage" },
};

/**
 * The session's user as the one managing users and roles, at `at`, with what they hold:
 * their permissions and the value of each declared limit.
 */
function managerOf(session: Session, at: Date, catalogue: PermissionCatalogue): Manager {
  const limits: Record<string, string> = {};
  for (const limit of catalogue.limits.keys()) {
    const value = session.grant.limitFor(limit);
    if (!value.unlimited) limits[limit] = value.value;
  }
  return {
    tenantId: session.tenantId,
    branchId: session.branchId,
    userId: session.user.id,
    ...(session.deviceId === null ? {} : { deviceId: session.deviceId }),
    at,
    isOwner: session.user.role.isOwner,
    permissions: session.grant.permissions,
    limits,
  };
}

/** Where a sign-in request comes from: its address and the device credential it carries. */
function signInSource(request: FastifyRequest): SignInSource {
  return { address: request.ip, deviceCredential: deviceCredentialOf(request) };
}

/** The sign-in answer in the transport the client asked for (ADR-0022). */
function signedIn(loggedIn: LoggedIn, transport: "bearer" | "cookie", reply: FastifyReply) {
  const expiresAt = loggedIn.expiresAt.toISOString();
  if (transport === "bearer") return { ...loggedIn, expiresAt };
  const { token, ...rest } = loggedIn;
  reply.header("set-cookie", sessionCookie(token, loggedIn.expiresAt));
  return { ...rest, expiresAt };
}

const signInRefusals = {
  401: problemDetailsSchema,
  403: problemDetailsSchema,
  429: problemDetailsSchema,
};

/** `core.access` routes, under `/api/v1/access`. */
export function accessRoutes(scope: FastifyInstance, context: AccessContext): void {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  // Per source address, and per unknown store code and login: this process's memory (rule 21).
  const signIn = { ...context, throttles: signInThrottles() };

  app.post(
    "/login",
    {
      config: { access: "public" },
      schema: {
        tags,
        body: loginRequestSchema,
        response: { 200: loginResponseSchema, ...signInRefusals },
      },
    },
    async (request, reply) => {
      const { transport, ...credentials } = request.body;
      // A forged sign-in would put the victim's browser in the attacker's session.
      if (transport === "cookie" && !isSameOrigin(request)) throw crossOriginRefused();
      const loggedIn = await logIn(context.tenants, credentials, signInSource(request), signIn);
      return signedIn(loggedIn, transport, reply);
    },
  );

  app.post(
    "/pin-login",
    {
      // The device credential (`Mustawfi-Device`) and the PIN are the credentials (rule 21).
      config: { access: "public" },
      schema: {
        tags,
        body: pinLoginRequestSchema,
        response: { 200: loginResponseSchema, ...signInRefusals },
      },
    },
    async (request, reply) => {
      const { transport, ...credentials } = request.body;
      if (transport === "cookie" && !isSameOrigin(request)) throw crossOriginRefused();
      const loggedIn = await logInWithPin(
        context.tenants,
        credentials,
        signInSource(request),
        signIn,
      );
      return signedIn(loggedIn, transport, reply);
    },
  );

  app.post(
    "/password-reset",
    {
      // The support reset code is the credential (rule 27).
      config: { access: "public" },
      schema: {
        tags,
        body: passwordResetRequestSchema,
        response: { 204: z.null(), ...signInRefusals },
      },
    },
    async (request, reply) => {
      await resetPasswordWithCode(context.tenants, request.body, signInSource(request), signIn);
      return reply.status(204).send(null);
    },
  );

  app.post(
    "/logout",
    {
      config: { access: "session" },
      schema: {
        tags,
        response: { 204: z.null(), 401: problemDetailsSchema, 403: problemDetailsSchema },
      },
    },
    async (request, reply) => {
      const session = sessionOf(request);
      await revokeSession(context.tenants, session, context);
      return reply.status(204).header("set-cookie", CLEARED_SESSION_COOKIE).send(null);
    },
  );

  app.get(
    "/session",
    {
      config: { access: "session" },
      schema: { tags, response: { 200: currentSessionSchema, 401: problemDetailsSchema } },
    },
    (request) => {
      const session = sessionOf(request);
      return {
        tenantId: session.tenantId,
        expiresAt: session.expiresAt.toISOString(),
        user: session.user,
      };
    },
  );

  app.post(
    "/registration-codes",
    {
      config: manageDevices,
      schema: {
        tags,
        response: {
          201: registrationCodeResponseSchema,
          401: problemDetailsSchema,
          403: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const session = sessionOf(request);
      const issued = await context.tenants.withTenant(
        { tenantId: session.tenantId, userId: session.user.id },
        async (tx) => {
          const tenant = await currentTenant(tx);
          if (tenant === undefined) throw new Error("session of a missing tenant");
          const code = await issueRegistrationCode(
            tx,
            { tenantId: session.tenantId, branchId: session.branchId, userId: session.user.id },
            context,
          );
          return { code: code.code, storeCode: tenant.storeCode, expiresAt: code.expiresAt };
        },
      );
      return reply.status(201).send({ ...issued, expiresAt: issued.expiresAt.toISOString() });
    },
  );

  app.post(
    "/devices",
    {
      // The registration code is the credential (ADR-0022).
      config: { access: "public" },
      schema: {
        tags,
        body: registerDeviceRequestSchema,
        response: {
          201: registeredDeviceSchema,
          401: problemDetailsSchema,
          409: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const { storeCode, registrationCode, type, name } = request.body;
      const tenantId = await context.tenants.resolveStoreCode(storeCode);
      if (tenantId === undefined) throw registrationFailed();
      const registered = await context.tenants.withTenant({ tenantId }, (tx) =>
        registerDevice(tx, { tenantId, registrationCode, type, name }, context),
      );
      return reply.status(201).send(registered);
    },
  );

  app.get(
    "/devices/current",
    {
      config: { access: "device" },
      schema: { tags, response: { 200: currentDeviceSchema, 401: problemDetailsSchema } },
    },
    (request) => {
      const device = deviceOf(request);
      return {
        deviceId: device.deviceId,
        tenantId: device.tenantId,
        prefix: device.prefix,
        type: device.type,
        name: device.name,
      };
    },
  );

  app.post(
    "/devices/current/wipe",
    {
      // A revoked device reports its wipe with its credential, as it pushed (rule 23).
      config: { access: "deviceEvenRevoked" },
      schema: {
        tags,
        response: { 204: z.null(), 401: problemDetailsSchema, 409: problemDetailsSchema },
      },
    },
    async (request, reply) => {
      await reportDeviceWiped(context.tenants, deviceOf(request), context);
      return reply.status(204).send(null);
    },
  );

  app.get(
    "/devices",
    {
      config: manageDevices,
      schema: {
        tags,
        response: { 200: z.object({ items: z.array(deviceViewSchema) }), ...refusals },
      },
    },
    async (request) => {
      const session = sessionOf(request);
      const items = await context.tenants.withTenant(
        { tenantId: session.tenantId, userId: session.user.id },
        (tx) => listDevices(tx),
      );
      return { items };
    },
  );

  app.post(
    "/devices/:id/revoke",
    {
      config: manageDevices,
      schema: {
        tags,
        params: idParamsSchema,
        body: revokeDeviceRequestSchema,
        response: { 200: deviceViewSchema, ...refusals },
      },
    },
    (request) =>
      asManager(sessionOf(request), (tx, manager) =>
        revokeDevice(
          tx,
          manager,
          { deviceId: request.params.id, reason: request.body.reason },
          context,
        ),
      ),
  );

  /** Runs `fn` in the session's tenant with the session's user as the manager. */
  function asManager<T>(
    session: Session,
    fn: (tx: TenantTransaction, manager: Manager) => Promise<T>,
  ): Promise<T> {
    const manager = managerOf(session, context.clock.now(), context.permissionCatalogue);
    return context.tenants.withTenant(
      { tenantId: session.tenantId, userId: session.user.id },
      (tx) => fn(tx, manager),
    );
  }

  app.get(
    "/catalogue",
    {
      config: viewUsers,
      schema: { tags, response: { 200: permissionCatalogueSchema, ...refusals } },
    },
    () => ({
      permissions: [...context.permissionCatalogue.permissions.values()].map((p) => ({
        id: p.id,
        moduleId: p.moduleId,
        scoped: p.scoped,
      })),
      limits: [...context.permissionCatalogue.limits.values()].map((l) => ({
        id: l.id,
        moduleId: l.moduleId,
        kind: l.kind,
      })),
    }),
  );

  app.get(
    "/roles",
    {
      config: viewUsers,
      schema: {
        tags,
        response: { 200: z.object({ items: z.array(roleViewSchema) }), ...refusals },
      },
    },
    async (request) => {
      const items = await asManager(sessionOf(request), (tx) =>
        listRoles(tx, context.permissionCatalogue),
      );
      return { items };
    },
  );

  app.post(
    "/roles",
    {
      config: manageRoles,
      schema: { tags, body: roleRequestSchema, response: { 201: roleViewSchema, ...refusals } },
    },
    async (request, reply) => {
      const role = await asManager(sessionOf(request), (tx, manager) =>
        copyRole(tx, manager, request.body, context.permissionCatalogue, context),
      );
      return reply.status(201).send(role);
    },
  );

  app.put(
    "/roles/:id",
    {
      config: manageRoles,
      schema: {
        tags,
        params: idParamsSchema,
        body: roleRequestSchema,
        response: { 200: roleViewSchema, ...refusals },
      },
    },
    async (request) =>
      asManager(sessionOf(request), (tx, manager) =>
        editRole(
          tx,
          manager,
          { ...request.body, id: request.params.id },
          context.permissionCatalogue,
          context,
        ),
      ),
  );

  app.post(
    "/roles/:id/archive",
    {
      config: manageRoles,
      schema: { tags, params: idParamsSchema, response: { 200: roleViewSchema, ...refusals } },
    },
    async (request) =>
      asManager(sessionOf(request), (tx, manager) =>
        archiveRole(tx, manager, request.params.id, context.permissionCatalogue, context),
      ),
  );

  app.get(
    "/users",
    {
      config: viewUsers,
      schema: {
        tags,
        response: { 200: z.object({ items: z.array(userViewSchema) }), ...refusals },
      },
    },
    async (request) => {
      const items = await asManager(sessionOf(request), (tx) => listUsers(tx));
      return { items };
    },
  );

  app.post(
    "/users",
    {
      config: manageUsers,
      schema: { tags, body: newUserRequestSchema, response: { 201: userViewSchema, ...refusals } },
    },
    async (request, reply) => {
      const user = await asManager(sessionOf(request), (tx, manager) =>
        addUser(tx, manager, request.body, context.permissionCatalogue, context),
      );
      return reply.status(201).send(user);
    },
  );

  app.patch(
    "/users/:id",
    {
      config: manageUsers,
      schema: {
        tags,
        params: idParamsSchema,
        body: userChangeRequestSchema,
        response: { 200: userViewSchema, ...refusals },
      },
    },
    async (request) =>
      asManager(sessionOf(request), (tx, manager) =>
        changeUser(
          tx,
          manager,
          request.params.id,
          request.body,
          context.permissionCatalogue,
          context,
        ),
      ),
  );

  app.post(
    "/users/:id/deactivate",
    {
      config: manageUsers,
      schema: {
        tags,
        params: idParamsSchema,
        body: deactivateUserRequestSchema,
        response: { 200: userViewSchema, ...refusals },
      },
    },
    async (request) =>
      asManager(sessionOf(request), (tx, manager) =>
        deactivateUser(tx, manager, request.params.id, request.body.reason, context),
      ),
  );

  app.post(
    "/users/:id/reactivate",
    {
      config: manageUsers,
      schema: { tags, params: idParamsSchema, response: { 200: userViewSchema, ...refusals } },
    },
    async (request) =>
      asManager(sessionOf(request), (tx, manager) =>
        reactivateUser(tx, manager, request.params.id, context),
      ),
  );

  app.put(
    "/users/:id/pin",
    {
      config: manageUsers,
      schema: {
        tags,
        params: idParamsSchema,
        body: setPinRequestSchema,
        response: { 200: userViewSchema, ...refusals },
      },
    },
    async (request) =>
      asManager(sessionOf(request), (tx, manager) =>
        setUserPin(tx, manager, request.params.id, request.body.pin, context),
      ),
  );

  app.put(
    "/users/:id/password",
    {
      config: manageUsers,
      schema: {
        tags,
        params: idParamsSchema,
        body: setPasswordRequestSchema,
        response: { 200: userViewSchema, ...refusals },
      },
    },
    async (request) =>
      asManager(sessionOf(request), (tx, manager) =>
        setUserPassword(tx, manager, request.params.id, request.body.password, context),
      ),
  );

  app.put(
    "/me/pin",
    {
      // The user's own account: any signed-in user (rule 17).
      config: { access: "session" },
      schema: { tags, body: changeOwnPinRequestSchema, response: { 204: z.null(), ...refusals } },
    },
    async (request, reply) => {
      const { pin, ...current } = request.body;
      await asManager(sessionOf(request), (tx, actor) =>
        changeOwnPin(tx, actor, current, pin, context),
      );
      return reply.status(204).send(null);
    },
  );

  app.put(
    "/me/password",
    {
      config: { access: "session" },
      schema: {
        tags,
        body: changeOwnPasswordRequestSchema,
        response: { 204: z.null(), ...refusals },
      },
    },
    async (request, reply) => {
      const { password, ...current } = request.body;
      await asManager(sessionOf(request), (tx, actor) =>
        changeOwnPassword(tx, actor, current, password, context),
      );
      return reply.status(204).send(null);
    },
  );
}
