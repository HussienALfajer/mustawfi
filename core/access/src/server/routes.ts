import { ProblemError } from "@mustawfi/core-config/server";
import { type PermissionCatalogue, problemDetailsSchema } from "@mustawfi/core-config/shared";
import {
  currentLicenseStatus,
  currentTenant,
  type TenantTransaction,
} from "@mustawfi/core-tenancy/server";
import { licenseStanding } from "@mustawfi/core-tenancy/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  accessProblemCodes,
  catalogueView,
  accountViewSchema,
  changeOwnPasswordRequestSchema,
  clearTwoFactorRequestSchema,
  confirmTwoFactorRequestSchema,
  disableTwoFactorRequestSchema,
  recoveryCodesSchema,
  startTwoFactorRequestSchema,
  twoFactorEnrolmentSchema,
  changeOwnPinRequestSchema,
  currentDeviceSchema,
  currentSessionSchema,
  deactivateUserRequestSchema,
  deviceListSchema,
  deviceViewSchema,
  logoutRequestSchema,
  signOutReasonSchema,
  newUserRequestSchema,
  permissionCatalogueSchema,
  renameDeviceRequestSchema,
  roleListItemSchema,
  roleRequestSchema,
  roleViewSchema,
  setPasswordRequestSchema,
  setPinRequestSchema,
  userChangeRequestSchema,
  userListItemSchema,
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
  deviceLimitUse,
  issueRegistrationCode,
  listDeviceItems,
  registerDevice,
  registrationFailed,
  renameDevice,
  reportDeviceWiped,
  revokeDevice,
} from "./devices.ts";
import { type LoggedIn, logIn, logInWithPin, type SignInSource, signInThrottled } from "./login.ts";
import { resetPasswordWithCode } from "./reset-codes.ts";
import { archiveRole, copyRole, editRole, listRoleItems, restoreRole } from "./roles.ts";
import { deviceOf, type RouteAccess, type RouteConfig, sessionOf } from "./route-access.ts";
import {
  CLEARED_SESSION_COOKIE,
  crossOriginRefused,
  deviceCredentialOf,
  isSameOrigin,
  presentedSessionToken,
  revokeSession,
  type Session,
  SESSION_LIFETIME_MS,
  sessionCookie,
} from "./sessions.ts";
import { CURRENT_SECRET_FAILURE_LIMIT, FailureCounter, signInThrottles } from "./throttle.ts";
import { accountOf, confirmTwoFactor, disableTwoFactor, startTwoFactor } from "./two-factor.ts";
import {
  addUser,
  changeOwnPassword,
  changeOwnPin,
  changeUser,
  clearUserTwoFactor,
  deactivateUser,
  listUserItems,
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

/**
 * Sign-in, by password, PIN, or support reset code, stays open in every license state (rule 5);
 * a suspended license turns non-owners away when the session would open.
 */
const signInAccess: RouteConfig = { access: "public", allowedWhenReadOnly: true };

/** The user's own session and account stay open in every license state (rule 5). */
const ownAccount: RouteConfig = { access: "session", allowedWhenReadOnly: true };

/** `core.access` routes, under `/api/v1/access`. */
export function accessRoutes(scope: FastifyInstance, context: AccessContext): void {
  const app = scope.withTypeProvider<ZodTypeProvider>();
  // Per source address, and per unknown store code and login: this process's memory (rule 21).
  const signIn = { ...context, throttles: signInThrottles() };
  // Wrong current secrets per session, in this process's memory like the addresses: one session
  // lasts at most its lifetime, and the fifth ends it.
  const proofs = new FailureCounter(CURRENT_SECRET_FAILURE_LIMIT, SESSION_LIFETIME_MS);

  /**
   * Runs a change of the signed-in user's own account that a current PIN or password proves
   * (`403 access.user.currentSecretWrong` when wrong). The fifth wrong one in a session ends the
   * session, audited `access.session.revoked` for `currentSecretFailures`, and is answered
   * 401 `access.session.required`: the user signs in again (QA slice 24, user decision). Proofs
   * still in flight count, so parallel guesses cannot pass the fifth together (429).
   */
  async function provedBy<T>(session: Session, change: () => Promise<T>): Promise<T> {
    const now = context.clock.now();
    if (proofs.busy(session.sessionId, now)) {
      throw signInThrottled(new Date(now.getTime() + 1000), now);
    }
    const attempt = proofs.begin(session.sessionId, now);
    let result: T;
    try {
      result = await change();
    } catch (error) {
      if (!(
        error instanceof ProblemError && error.code === accessProblemCodes.currentSecretWrong
      )) {
        attempt.release();
        throw error;
      }
      attempt.fail();
      if (proofs.throttledUntil(session.sessionId, now) === undefined) throw error;
      await revokeSession(context.tenants, session, context, "currentSecretFailures");
      throw new ProblemError(accessProblemCodes.sessionRequired, 401, {
        title: "Too many wrong current PINs or passwords: sign in again",
      });
    }
    attempt.release();
    return result;
  }

  app.post(
    "/login",
    {
      config: signInAccess,
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
      config: signInAccess,
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
      config: signInAccess,
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
      config: { access: "session", allowedWhenReadOnly: true },
      schema: {
        tags,
        body: logoutRequestSchema,
        response: { 204: z.null(), 401: problemDetailsSchema, 403: problemDetailsSchema },
      },
    },
    async (request, reply) => {
      const session = sessionOf(request);
      const reason = signOutReasonSchema.safeParse(request.body?.reason).data ?? "signedOut";
      await revokeSession(context.tenants, session, context, reason);
      return reply.status(204).header("set-cookie", CLEARED_SESSION_COOKIE).send(null);
    },
  );

  app.get(
    "/session",
    {
      config: { access: "session" },
      schema: { tags, response: { 200: currentSessionSchema, 401: problemDetailsSchema } },
    },
    async (request) => {
      const session = sessionOf(request);
      // The license by the server's clock, so the client explains read-only and warns owners.
      const status = await context.tenants.withTenant({ tenantId: session.tenantId }, (tx) =>
        currentLicenseStatus(tx, context.clock.now()),
      );
      return {
        tenantId: session.tenantId,
        expiresAt: session.expiresAt.toISOString(),
        user: session.user,
        license: licenseStanding(status.license.claims, status.state),
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
      const { storeCode, registrationCode, type, platform, name } = request.body;
      const tenantId = await context.tenants.resolveStoreCode(storeCode);
      if (tenantId === undefined) throw registrationFailed();
      // The session that registers the device is bound to it (rule 22).
      const sessionToken = presentedSessionToken(request);
      const registered = await context.tenants.withTenant({ tenantId }, (tx) =>
        registerDevice(
          tx,
          { tenantId, registrationCode, type, platform, name, sessionToken },
          context,
        ),
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
    async (request) => {
      const device = deviceOf(request);
      const limit = await context.tenants.withTenant(
        { tenantId: device.tenantId, deviceId: device.deviceId },
        (tx) => deviceLimitUse(tx, device.type),
      );
      return {
        deviceId: device.deviceId,
        tenantId: device.tenantId,
        prefix: device.prefix,
        type: device.type,
        platform: device.platform,
        name: device.name,
        limit,
      };
    },
  );

  app.post(
    "/devices/current/wipe",
    {
      // A revoked device reports its wipe with its credential, as it pushed (rule 23).
      config: { access: "deviceEvenRevoked", allowedWhenReadOnly: true },
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
        response: { 200: deviceListSchema, ...refusals },
      },
    },
    async (request) => {
      const session = sessionOf(request);
      return context.tenants.withTenant(
        { tenantId: session.tenantId, userId: session.user.id },
        (tx) => listDeviceItems(tx),
      );
    },
  );

  app.patch(
    "/devices/:id",
    {
      config: manageDevices,
      schema: {
        tags,
        params: idParamsSchema,
        body: renameDeviceRequestSchema,
        response: { 200: deviceViewSchema, ...refusals },
      },
    },
    (request) =>
      asManager(sessionOf(request), (tx, manager) =>
        renameDevice(
          tx,
          manager,
          { deviceId: request.params.id, name: request.body.name },
          context,
        ),
      ),
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

  // Every session: a client without the bundle resolves its user's grant against it
  // (`core-foundation` slice 16). It names what the modules declare, nothing of the tenant's.
  app.get(
    "/catalogue",
    {
      config: { access: "session" },
      schema: { tags, response: { 200: permissionCatalogueSchema, ...refusals } },
    },
    () => catalogueView(context.permissionCatalogue),
  );

  app.get(
    "/roles",
    {
      config: viewUsers,
      schema: {
        tags,
        response: { 200: z.object({ items: z.array(roleListItemSchema) }), ...refusals },
      },
    },
    async (request) => {
      const items = await asManager(sessionOf(request), (tx) =>
        listRoleItems(tx, context.permissionCatalogue),
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

  app.post(
    "/roles/:id/restore",
    {
      config: manageRoles,
      schema: { tags, params: idParamsSchema, response: { 200: roleViewSchema, ...refusals } },
    },
    async (request) =>
      asManager(sessionOf(request), (tx, manager) =>
        restoreRole(tx, manager, request.params.id, context.permissionCatalogue, context),
      ),
  );

  app.get(
    "/users",
    {
      config: viewUsers,
      schema: {
        tags,
        response: { 200: z.object({ items: z.array(userListItemSchema) }), ...refusals },
      },
    },
    async (request) => {
      const items = await asManager(sessionOf(request), (tx) => listUserItems(tx));
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
        setUserPin(
          tx,
          manager,
          request.params.id,
          request.body.pin,
          context.permissionCatalogue,
          context,
        ),
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
        setUserPassword(
          tx,
          manager,
          request.params.id,
          request.body.password,
          context.permissionCatalogue,
          context,
        ),
      ),
  );

  app.post(
    "/users/:id/two-factor/clear",
    {
      // Owners only (rule 26), checked by `clearUserTwoFactor`.
      config: manageUsers,
      schema: {
        tags,
        params: idParamsSchema,
        body: clearTwoFactorRequestSchema,
        response: { 200: userViewSchema, ...refusals },
      },
    },
    async (request) =>
      asManager(sessionOf(request), (tx, manager) =>
        clearUserTwoFactor(tx, manager, request.params.id, request.body.reason, context),
      ),
  );

  app.get(
    "/me",
    {
      // The user's own account: any signed-in user (rule 17), in every license state (rule 5).
      config: ownAccount,
      schema: { tags, response: { 200: accountViewSchema, ...refusals } },
    },
    async (request) => {
      const session = sessionOf(request);
      return context.tenants.withTenant(
        { tenantId: session.tenantId, userId: session.user.id },
        (tx) => accountOf(tx, session.user.id),
      );
    },
  );

  app.post(
    "/me/two-factor/enrolment",
    {
      config: ownAccount,
      schema: {
        tags,
        body: startTwoFactorRequestSchema,
        response: { 201: twoFactorEnrolmentSchema, ...refusals },
      },
    },
    async (request, reply) => {
      const session = sessionOf(request);
      const enrolment = await provedBy(session, () =>
        asManager(session, (tx, actor) =>
          startTwoFactor(tx, actor, request.body.currentPassword, context),
        ),
      );
      return reply.status(201).send(enrolment);
    },
  );

  app.post(
    "/me/two-factor/confirm",
    {
      config: ownAccount,
      schema: {
        tags,
        body: confirmTwoFactorRequestSchema,
        response: { 200: recoveryCodesSchema, ...refusals },
      },
    },
    async (request) =>
      asManager(sessionOf(request), (tx, actor) =>
        confirmTwoFactor(tx, actor, request.body.code, context),
      ),
  );

  app.post(
    "/me/two-factor/disable",
    {
      config: ownAccount,
      schema: {
        tags,
        body: disableTwoFactorRequestSchema,
        response: { 204: z.null(), ...refusals },
      },
    },
    async (request, reply) => {
      const session = sessionOf(request);
      await provedBy(session, () =>
        asManager(session, (tx, actor) => disableTwoFactor(tx, actor, request.body, context)),
      );
      return reply.status(204).send(null);
    },
  );

  app.put(
    "/me/pin",
    {
      config: ownAccount,
      schema: { tags, body: changeOwnPinRequestSchema, response: { 204: z.null(), ...refusals } },
    },
    async (request, reply) => {
      const { pin, ...current } = request.body;
      const session = sessionOf(request);
      await provedBy(session, () =>
        asManager(session, (tx, actor) => changeOwnPin(tx, actor, current, pin, context)),
      );
      return reply.status(204).send(null);
    },
  );

  app.put(
    "/me/password",
    {
      config: ownAccount,
      schema: {
        tags,
        body: changeOwnPasswordRequestSchema,
        response: { 204: z.null(), ...refusals },
      },
    },
    async (request, reply) => {
      const { password, ...current } = request.body;
      const session = sessionOf(request);
      await provedBy(session, () =>
        asManager(session, (tx, actor) =>
          changeOwnPassword(
            tx,
            { ...actor, sessionId: session.sessionId },
            current,
            password,
            context,
          ),
        ),
      );
      return reply.status(204).send(null);
    },
  );
}
