import {
  ApiProblem,
  apiRequest,
  ApiUnreachable,
  type BundleVerifier,
  CONFIG_BUNDLE_REFUSAL_TABLE,
  CONFIG_BUNDLE_TABLE,
  forgetSession,
  hasSessionCredential,
  holdSession,
  loadBundle,
  sessionTransport,
} from "@mustawfi/core-config/client";
import type { Clock } from "@mustawfi/kernel";
import type { LocalDb } from "@mustawfi/local-db";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import {
  type AccessGrant,
  accessGrant,
  type AccessPart,
  bundleUserAccess,
  catalogueFromView,
  loginResponseSchema,
  permissionCatalogueSchema,
  sessionUserAccess,
  type sessionUserSchema,
} from "../../shared/index.ts";
import { ACCESS_DEVICE_TABLE, localDevice } from "../device.ts";
import { type CurrentSession, fetchSession, sessionQueryKey } from "../session.ts";
import {
  accessPartOf,
  attachServerSession,
  type BundleRole,
  type BundleUser,
  bundleUser,
  clearPinFailures,
  endLocalSession,
  isIdle,
  lastActivityAt,
  LOCAL_SESSION_TABLE,
  type LocalPinDependencies,
  type LocalPinOutcome,
  type LocalSession,
  localSession,
  openLocalSession,
  signInLocally,
  type UnlockOutcome,
  unlockUser,
} from "./local-sign-in.ts";

type SessionUser = z.infer<typeof sessionUserSchema>;

/**
 * Who is signed in on this client (ADR-0022, `core-foundation` flow 12): on a registered device,
 * the user of its local session — with the server's view of them when this client holds a server
 * session for that user, else as the verified bundle describes them (offline); on any other
 * client, the server session's user.
 */
export interface SignedIn {
  readonly tenantId: string;
  readonly user: SessionUser;
  /** The server session of this user, when this client holds one and the server answered. */
  readonly server: CurrentSession | null;
  /** This device's session, on a registered device of the user's store; else null. */
  readonly device: LocalSession | null;
  /**
   * What the user may do (`core-foundation` slice 16): resolved like the server resolves it, from
   * the verified bundle on a registered device of the user's store — online or not, so a screen
   * shows the same offline — and from the server's session answer and catalogue elsewhere.
   */
  readonly grant: AccessGrant;
}

/** How long a PIN sign-in waits for the server before checking the PIN on the device. */
export const PIN_SERVER_TIMEOUT_MS = 4_000;

/** Under the session's key, so what refreshes the session refreshes this too. */
export const signedInQueryKey = [...sessionQueryKey, "signedIn"] as const;

/** The session user as the bundle describes them, for a device signed in without the server. */
function userFromBundle(user: BundleUser, role: BundleRole): SessionUser {
  return {
    id: user.id,
    name: user.name,
    login: null,
    role: { id: role.id, name: role.name, isOwner: role.isOwner },
    departmentScope: user.departmentScope,
    departments: user.departments,
    // Every declared permission for the owner role; a scoped one holds only in the scope.
    permissions: role.permissions,
    limits: role.isOwner ? {} : role.limits,
  };
}

/** `userId`'s grant as the bundle's `access` part describes them, if it allows them here. */
function bundleGrant(access: AccessPart | undefined, userId: string): AccessGrant | undefined {
  const held = access === undefined ? undefined : bundleUserAccess(access, userId);
  return access === undefined || held === undefined
    ? undefined
    : accessGrant(catalogueFromView(access.catalogue), held);
}

/** The session user's grant, resolved against the server's catalogue (a client with no bundle). */
async function serverGrant(server: CurrentSession, signal?: AbortSignal): Promise<AccessGrant> {
  const catalogue = await apiRequest("/api/v1/access/catalogue", {
    schema: permissionCatalogueSchema,
    ...(signal === undefined ? {} : { signal }),
  });
  return accessGrant(catalogueFromView(catalogue), sessionUserAccess(server.user));
}

/** The server session, or null when the server cannot be reached. */
async function reachableSession(signal?: AbortSignal): Promise<CurrentSession | null> {
  // Bounded: every screen waits for who is signed in, and a server that never answers must not
  // keep a device from selling (non-negotiable 4).
  const timeout = AbortSignal.timeout(PIN_SERVER_TIMEOUT_MS);
  try {
    return await fetchSession(signal === undefined ? timeout : AbortSignal.any([signal, timeout]));
  } catch (error) {
    if (error instanceof ApiUnreachable) return null;
    throw error;
  }
}

/**
 * Reads who is signed in (`SignedIn`), or null. On a registered device only its local session
 * counts: a server session of this store without one (a cookie left from before a lock) signs
 * nobody in, while another store's session is that store's back office, as on any browser.
 */
export async function fetchSignedIn(
  db: LocalDb,
  verifier: BundleVerifier,
  signal?: AbortSignal,
): Promise<SignedIn | null> {
  const device = await localDevice(db);
  const local = device === undefined ? undefined : await localSession(db);
  if (device === undefined || local === undefined || local.tenantId !== device.tenantId) {
    const server =
      device === undefined ? await fetchSession(signal) : await reachableSession(signal);
    if (server === null || server.tenantId === device?.tenantId) return null;
    const grant = await serverGrant(server, signal);
    return { tenantId: server.tenantId, user: server.user, server, device: null, grant };
  }
  let server: CurrentSession | null = null;
  if (local.serverSession && hasSessionCredential()) {
    server = await reachableSession(signal);
    // Only this user's session speaks for them; another user's is not sent again (rule 25).
    if (server !== null && server.user.id !== local.userId) {
      forgetSession();
      server = null;
    }
  }
  const access = accessPartOf(await loadBundle(db, verifier, device));
  const found = access === undefined ? undefined : bundleUser(access, local.userId);
  const grant = bundleGrant(access, local.userId);
  if (server !== null) {
    if (found !== undefined && grant !== undefined) {
      // The scope beside the grant comes from the same bundle, so a sale's department and the
      // check of it never disagree while a newer bundle is on its way.
      const { departmentScope, departments } = found.user;
      const user = { ...server.user, departmentScope, departments };
      return { tenantId: server.tenantId, user, server, device: local, grant };
    }
    // A device signed in by password before its first bundle arrived: the server's view,
    // bounded like the session, and out of reach it is signed in as without the server.
    try {
      const fromServer = await serverGrant(
        server,
        AbortSignal.any([
          ...(signal === undefined ? [] : [signal]),
          AbortSignal.timeout(PIN_SERVER_TIMEOUT_MS),
        ]),
      );
      return {
        tenantId: server.tenantId,
        user: server.user,
        server,
        device: local,
        grant: fromServer,
      };
    } catch (error) {
      if (!(error instanceof ApiUnreachable)) throw error;
    }
  }
  // No longer allowed on this device (deactivated, in a newer bundle): back to the PIN screen.
  if (found === undefined || grant === undefined) return null;
  return {
    tenantId: device.tenantId,
    user: userFromBundle(found.user, found.role),
    server: null,
    device: local,
    grant,
  };
}

export function signedInQueryOptions(db: LocalDb, verifier: BundleVerifier) {
  return queryOptions({
    queryKey: signedInQueryKey,
    queryFn: ({ signal }) => fetchSignedIn(db, verifier, signal),
    staleTime: 60_000,
    retry: false,
    // Offline too: the device signs in from its own database.
    networkMode: "always",
    meta: {
      localTables: [
        LOCAL_SESSION_TABLE,
        ACCESS_DEVICE_TABLE,
        CONFIG_BUNDLE_TABLE,
        CONFIG_BUNDLE_REFUSAL_TABLE,
      ],
    },
  });
}

/**
 * At start-up, before anything calls the API: a device's session left idle for `idleMs` is over
 * (rule 24), and a session cookie this device's user did not open here is not sent (rule 25).
 */
export async function restoreDeviceSession(
  db: LocalDb,
  clock: Clock,
  idleMs: number,
): Promise<void> {
  const device = await localDevice(db);
  if (device === undefined) return;
  let session = await localSession(db);
  if (session !== undefined && isIdle(await lastActivityAt(db), clock.now(), idleMs)) {
    await endLocalSession(db);
    session = undefined;
  }
  if (session === undefined || !session.serverSession) forgetSession();
}

/**
 * After a password sign-in (flow 4): on a registered device of the user's store, that user is
 * now the one signed in on it, with the server session the sign-in opened.
 */
export async function beginDeviceSession(
  db: LocalDb,
  session: CurrentSession,
  clock: Clock,
): Promise<void> {
  const device = await localDevice(db);
  if (device?.tenantId !== session.tenantId) return;
  await db.transaction(async (tx) => {
    await openLocalSession(
      tx,
      {
        userId: session.user.id,
        tenantId: session.tenantId,
        method: "password",
        serverSession: true,
      },
      clock.now(),
    );
  });
}

/** The previous user's server session being ended, which the next PIN sign-in waits for. */
let endingServerSession: Promise<void> = Promise.resolve();

/**
 * Ends the session on this device — auto-lock, switching user, or signing out (rules 24–25):
 * the local session goes, and the server session with it, told to the server when it can be;
 * offline, the token is forgotten and a cookie is no longer sent.
 */
export async function lockDevice(db: LocalDb): Promise<void> {
  const session = await localSession(db);
  await endLocalSession(db);
  if (session?.serverSession === true && hasSessionCredential()) {
    // Built with the session before it is forgotten below. Its answer clears the cookie, so the
    // next PIN sign-in waits for it rather than have its new cookie cleared.
    endingServerSession = apiRequest("/api/v1/access/logout", {
      method: "POST",
      schema: z.null(),
      signal: AbortSignal.timeout(PIN_SERVER_TIMEOUT_MS),
    }).then(
      () => undefined,
      () => undefined,
    );
  }
  forgetSession();
}

export interface PinSignInDependencies extends LocalPinDependencies {
  readonly verifier: BundleVerifier;
  /** Whether to ask the server first; the browser's `navigator.onLine` by default. */
  readonly online?: () => boolean;
  readonly serverTimeoutMs?: number;
  readonly fetch?: typeof fetch;
}

/** What a PIN sign-in came to. */
export type PinSignInOutcome =
  | Exclude<LocalPinOutcome, { readonly outcome: "verified" }>
  /** Signed in: with the server's session when it answered, else checked on the device. */
  | { readonly outcome: "signedIn"; readonly server: CurrentSession | null }
  /** The server answered with a refusal (wrong PIN, throttled, suspended, revoked…). */
  | { readonly outcome: "refused"; readonly code: string }
  /** The server is out of reach, and this device has no bundle to check the PIN against. */
  | { readonly outcome: "noBundle" }
  /** Asked for the server alone (rule 25), and it is out of reach. */
  | { readonly outcome: "unreachable" };

function browserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

/** `POST /pin-login`: the server session on this device, or why not (`ApiProblem`). */
async function serverPinSignIn(
  input: { readonly userId: string; readonly pin: string },
  dependencies: PinSignInDependencies,
): Promise<CurrentSession> {
  await endingServerSession;
  const transport = sessionTransport();
  const answer = await apiRequest("/api/v1/access/pin-login", {
    method: "POST",
    body: { userId: input.userId, pin: input.pin, transport },
    schema: loginResponseSchema,
    opensSession: true,
    signal: AbortSignal.timeout(dependencies.serverTimeoutMs ?? PIN_SERVER_TIMEOUT_MS),
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
  });
  if (transport === "bearer" && answer.token === undefined) {
    throw new Error("the bearer PIN sign-in returned no token");
  }
  holdSession(answer.token);
  return {
    tenantId: answer.tenantId,
    expiresAt: answer.expiresAt,
    user: answer.user,
    license: answer.license,
  };
}

/**
 * Signs a user in by PIN on this device (flow 12, rules 20–22 and 25). The server checks the PIN
 * when it answers — its rate limit governs the user there, and a right PIN lifts a lockout on the
 * device — and opens a session bound to this device. Out of reach (offline, or no answer within
 * the timeout), the device checks the PIN against the bundle and counts wrong ones itself; any
 * server session held before is forgotten, so the next action needing the server asks for the
 * PIN again.
 *
 * With `serverOnly` (rule 25, the signed-in user reconnecting), the device never checks the PIN
 * itself: out of reach is `unreachable`.
 */
export async function signInWithPin(
  db: LocalDb,
  input: { readonly userId: string; readonly pin: string; readonly serverOnly?: boolean },
  dependencies: PinSignInDependencies,
): Promise<PinSignInOutcome> {
  const device = await localDevice(db);
  if (device === undefined) throw new Error("PIN sign-in needs a registered device");
  if (input.serverOnly === true || (dependencies.online ?? browserOnline)()) {
    try {
      const server = await serverPinSignIn(input, dependencies);
      if (server.tenantId !== device.tenantId)
        throw new Error("the server signed in another store");
      await db.transaction(async (tx) => {
        await clearPinFailures(tx, input.userId);
        const current = input.serverOnly === true ? await localSession(tx) : undefined;
        if (current?.userId === input.userId) await attachServerSession(tx, input.userId);
        else {
          await openLocalSession(
            tx,
            { userId: input.userId, tenantId: device.tenantId, method: "pin", serverSession: true },
            dependencies.clock.now(),
          );
        }
      });
      return { outcome: "signedIn", server };
    } catch (error) {
      if (error instanceof ApiProblem) return { outcome: "refused", code: error.code };
      if (!(error instanceof ApiUnreachable)) throw error;
      if (input.serverOnly === true) return { outcome: "unreachable" };
    }
  }
  const access = accessPartOf(
    await loadBundle(db, dependencies.verifier, {
      deviceId: device.deviceId,
      tenantId: device.tenantId,
    }),
  );
  if (access === undefined) return { outcome: "noBundle" };
  const outcome = await signInLocally(db, access, device, input, dependencies);
  if (outcome.outcome !== "verified") return outcome;
  // A session held from before (another user's cookie, say) must not act for this user.
  forgetSession();
  return { outcome: "signedIn", server: null };
}

/**
 * A supervisor unlocks a locked-out user on this device (flow 13), checked against the bundle
 * whether or not the server can be reached: the lockout is the device's own count.
 */
export async function unlockOnDevice(
  db: LocalDb,
  input: { readonly lockedUserId: string; readonly supervisorId: string; readonly pin: string },
  dependencies: PinSignInDependencies,
): Promise<UnlockOutcome | { readonly outcome: "noBundle" }> {
  const device = await localDevice(db);
  if (device === undefined) throw new Error("unlocking needs a registered device");
  const access = accessPartOf(
    await loadBundle(db, dependencies.verifier, {
      deviceId: device.deviceId,
      tenantId: device.tenantId,
    }),
  );
  if (access === undefined) return { outcome: "noBundle" };
  return unlockUser(db, access, input, dependencies);
}
