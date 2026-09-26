import { recordAudit } from "@mustawfi/core-audit/server";
import { ProblemError } from "@mustawfi/core-config/server";
import { DEVICE_CREDENTIAL_HEADER, type PermissionCatalogue } from "@mustawfi/core-config/shared";
import type { TenantDatabase, TenantTransaction } from "@mustawfi/core-tenancy/server";
import type { Clock } from "@mustawfi/kernel";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { z } from "zod";
import {
  accessGrant,
  accessProblemCodes,
  type AccessGrant,
  sessionUserSchema,
} from "../shared/index.ts";
import type { AccessDependencies } from "./dependencies.ts";
import { devices, sessions, users } from "./schema.ts";
import { issueBearer, readBearer } from "./secrets.ts";
import type { UserAccess } from "./users.ts";
import { userAccess } from "./users.ts";

/** A session lasts seven days from sign-in; a setting later. Revocation ends it sooner. */
export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** The signed-in user as the session answer shows them. */
export type SessionUser = z.infer<typeof sessionUserSchema>;

/** An authenticated session: who is acting, in which tenant, until when, allowed to do what. */
export interface Session {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly branchId: string;
  readonly deviceId: string | null;
  readonly expiresAt: Date;
  readonly user: SessionUser;
  /** The user's resolved permissions and limits, as of this request. */
  readonly grant: AccessGrant;
}

/** The session view of a user and their grant. */
export function sessionUser(
  user: { readonly id: string; readonly name: string; readonly login: string | null },
  access: UserAccess,
  catalogue: PermissionCatalogue,
): { readonly user: SessionUser; readonly grant: AccessGrant } {
  const grant = accessGrant(catalogue, access.access);
  return {
    grant,
    user: {
      id: user.id,
      name: user.name,
      login: user.login,
      role: access.role,
      departmentScope: access.access.departmentScope,
      departments: [...access.access.departments],
      permissions: [...grant.permissions],
      // The role's own values; the owner holds none and is unlimited (rule 14).
      limits: access.access.isOwner ? {} : { ...access.access.limits },
    },
  };
}

export interface OpenedSession {
  readonly sessionId: string;
  /** The bearer token, handed to the client once; only its hash is stored. */
  readonly token: string;
  readonly expiresAt: Date;
}

/** Opens a session for `userId` in `tx`, a `withTenant` transaction for `tenantId`. */
export async function openSession(
  tx: TenantTransaction,
  user: {
    readonly tenantId: string;
    readonly branchId: string;
    readonly userId: string;
    /** The registered device it is opened on: every request must then carry its credential. */
    readonly deviceId?: string;
    /** How the user proved who they are; `password` unless said. */
    readonly method?: "password" | "pin";
  },
  dependencies: AccessDependencies,
): Promise<OpenedSession> {
  const now = dependencies.clock.now();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
  const { token, hash } = issueBearer("session", user.tenantId, dependencies.random);
  const sessionId = dependencies.newId();
  await tx.insert(sessions).values({
    id: sessionId,
    tenantId: user.tenantId,
    branchId: user.branchId,
    createdAt: now,
    createdBy: user.userId,
    userId: user.userId,
    deviceId: user.deviceId ?? null,
    method: user.method ?? "password",
    tokenHash: hash,
    expiresAt,
  });
  return { sessionId, token, expiresAt };
}

/**
 * The session a bearer token opens, or `undefined` when the token is malformed, unknown,
 * expired, or revoked, or when the session was opened on a registered device and
 * `deviceCredential` is not that device's (`core-foundation` rule 22). Checked against the
 * database on every request, with the user's role and scope, so a revocation or a role change
 * takes effect on the next one (ADR-0022).
 */
export async function authenticateSession(
  tenants: TenantDatabase,
  token: string,
  context: { readonly clock: Clock; readonly permissionCatalogue: PermissionCatalogue },
  deviceCredential?: string,
): Promise<Session | undefined> {
  const bearer = readBearer("session", token);
  if (bearer === undefined) return undefined;
  const device =
    deviceCredential === undefined ? undefined : readBearer("device", deviceCredential);
  const now = context.clock.now();
  return tenants.withTenant({ tenantId: bearer.tenantId }, async (tx) => {
    const [row] = await tx
      .select({
        sessionId: sessions.id,
        tenantId: sessions.tenantId,
        branchId: sessions.branchId,
        deviceId: sessions.deviceId,
        expiresAt: sessions.expiresAt,
        user: { id: users.id, name: users.name, login: users.login },
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .leftJoin(devices, eq(devices.id, sessions.deviceId))
      .where(
        and(
          eq(sessions.tokenHash, bearer.hash),
          // A session opened on a device goes only with that device's credential, and ends
          // with its revoke (which also revokes the session; this holds even if one was missed).
          device === undefined
            ? isNull(sessions.deviceId)
            : or(
                isNull(sessions.deviceId),
                and(eq(devices.credentialHash, device.hash), isNull(devices.revokedAt)),
              ),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
          // Deactivating a user revokes their sessions; this holds even if one was missed.
          eq(users.status, "active"),
        ),
      );
    if (row === undefined) return undefined;
    const access = await userAccess(tx, row.user.id, context.permissionCatalogue);
    if (access === undefined) throw new Error(`session ${row.sessionId} has no user`);
    return { ...row, ...sessionUser(row.user, access, context.permissionCatalogue) };
  });
}

/** Ends `session` now, as its own user signing out; audited. */
export async function revokeSession(
  tenants: TenantDatabase,
  session: Session,
  dependencies: AccessDependencies,
): Promise<void> {
  const now = dependencies.clock.now();
  const userId = session.user.id;
  await tenants.withTenant({ tenantId: session.tenantId, userId }, async (tx) => {
    const revoked = await tx
      .update(sessions)
      .set({ revokedAt: now, revokedBy: userId })
      .where(and(eq(sessions.id, session.sessionId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (revoked.length === 0) return;
    await recordAudit(tx, {
      id: dependencies.newId(),
      tenantId: session.tenantId,
      branchId: session.branchId,
      occurredAt: now,
      userId,
      ...(session.deviceId === null ? {} : { deviceId: session.deviceId }),
      action: "access.session.revoked",
      entity: { type: "access.session", id: session.sessionId },
    });
  });
}

/** The browser's session cookie (ADR-0022); scripts never see it, and it goes to the API only. */
export const SESSION_COOKIE = "mustawfi_session";

const COOKIE_ATTRIBUTES = "Path=/api; HttpOnly; Secure; SameSite=Lax";

/** The `Set-Cookie` value that hands a browser its session. */
export function sessionCookie(token: string, expiresAt: Date): string {
  return `${SESSION_COOKIE}=${token}; Expires=${expiresAt.toUTCString()}; ${COOKIE_ATTRIBUTES}`;
}

/** The `Set-Cookie` value that removes the session cookie. */
export const CLEARED_SESSION_COOKIE = `${SESSION_COOKIE}=; Max-Age=0; ${COOKIE_ATTRIBUTES}`;

/** The session token of a `Cookie` header, if it carries one. */
export function cookieToken(cookie: string | undefined): string | undefined {
  for (const part of (cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE && value.length > 0 && value.join("=") !== "") {
      return value.join("=");
    }
  }
  return undefined;
}

/** What `requireSession` reads from a request. */
export interface SessionRequest {
  readonly method: string;
  readonly headers: {
    readonly authorization?: string | undefined;
    readonly cookie?: string | undefined;
    readonly origin?: string | undefined;
    readonly host?: string | undefined;
    readonly [DEVICE_CREDENTIAL_HEADER]?: string | string[] | undefined;
  };
}

/** The device credential a request carries beside its session (`Mustawfi-Device`), if one. */
export function deviceCredentialOf(request: Pick<SessionRequest, "headers">): string | undefined {
  const value = request.headers[DEVICE_CREDENTIAL_HEADER];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Methods that change nothing: no cross-origin check (here) and no license gate (rule 5). */
export const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether the request's `Origin` is the host it was sent to. A browser attaches the session
 * cookie by itself, so any change made with the cookie must come from our own pages (the CSRF
 * check of ADR-0022). The web app and the API share one origin.
 */
export function isSameOrigin(request: SessionRequest): boolean {
  const { origin, host } = request.headers;
  if (origin === undefined || host === undefined) return false;
  try {
    return new URL(origin).host === host.toLowerCase();
  } catch {
    return false;
  }
}

/** 403 `access.request.crossOrigin`. */
export function crossOriginRefused(): ProblemError {
  return new ProblemError(accessProblemCodes.crossOrigin, 403, {
    title: "This request must come from the Mustawfi app",
  });
}

/** The token of an `Authorization: Bearer <token>` header. */
export function bearerToken(authorization: string | undefined): string | undefined {
  return /^Bearer ([^\s]+)$/i.exec(authorization ?? "")?.[1];
}

/**
 * The session of a request's `Authorization: Bearer` header or, failing that, its session
 * cookie; otherwise a 401 `access.session.required` — the same refusal whatever was wrong with
 * it, a session opened on a device without that device's credential in `Mustawfi-Device`
 * included (rule 22). A change (not GET, HEAD, OPTIONS) made with the cookie from another origin is a 403
 * `access.request.crossOrigin`. The route guard (`installRouteAccess`) calls it for every
 * route that needs a signed-in user.
 */
export async function requireSession(
  request: SessionRequest,
  context: {
    readonly tenants: TenantDatabase;
    readonly clock: Clock;
    readonly permissionCatalogue: PermissionCatalogue;
  },
): Promise<Session> {
  let token = bearerToken(request.headers.authorization);
  if (token === undefined) {
    token = cookieToken(request.headers.cookie);
    if (token !== undefined && !SAFE_METHODS.has(request.method) && !isSameOrigin(request)) {
      throw crossOriginRefused();
    }
  }
  const session =
    token === undefined
      ? undefined
      : await authenticateSession(context.tenants, token, context, deviceCredentialOf(request));
  if (session === undefined) {
    throw new ProblemError(accessProblemCodes.sessionRequired, 401, {
      title: "Sign in to continue",
    });
  }
  return session;
}
