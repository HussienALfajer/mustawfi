import { recordAudit } from "@mustawfi/core-audit/server";
import { ProblemError } from "@mustawfi/core-config/server";
import type { TenantDatabase, TenantTransaction } from "@mustawfi/core-tenancy/server";
import type { Clock } from "@mustawfi/kernel";
import { and, eq, gt, isNull } from "drizzle-orm";
import { accessProblemCodes } from "../shared/index.ts";
import type { AccessDependencies } from "./dependencies.ts";
import { sessions, users } from "./schema.ts";
import { issueBearer, readBearer } from "./secrets.ts";

/** A session lasts seven days from sign-in; a setting later. Revocation ends it sooner. */
export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly login: string;
  readonly isOwner: boolean;
}

/** An authenticated session: who is acting, in which tenant, until when. */
export interface Session {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly branchId: string;
  readonly deviceId: string | null;
  readonly expiresAt: Date;
  readonly user: SessionUser;
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
    readonly deviceId?: string;
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
    tokenHash: hash,
    expiresAt,
  });
  return { sessionId, token, expiresAt };
}

/**
 * The session a bearer token opens, or `undefined` when the token is malformed, unknown,
 * expired, or revoked. Checked against the database on every request, so a revocation takes
 * effect on the next one (ADR-0022).
 */
export async function authenticateSession(
  tenants: TenantDatabase,
  token: string,
  clock: Clock,
): Promise<Session | undefined> {
  const bearer = readBearer("session", token);
  if (bearer === undefined) return undefined;
  const now = clock.now();
  const [row] = await tenants.withTenant({ tenantId: bearer.tenantId }, (tx) =>
    tx
      .select({
        sessionId: sessions.id,
        tenantId: sessions.tenantId,
        branchId: sessions.branchId,
        deviceId: sessions.deviceId,
        expiresAt: sessions.expiresAt,
        user: { id: users.id, name: users.name, login: users.login, isOwner: users.isOwner },
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, bearer.hash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
        ),
      ),
  );
  return row;
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

/** The token of an `Authorization: Bearer <token>` header. */
export function bearerToken(authorization: string | undefined): string | undefined {
  return /^Bearer ([^\s]+)$/i.exec(authorization ?? "")?.[1];
}

/**
 * The session of a request's `Authorization: Bearer` header, or a 401
 * `access.session.required` — the same refusal whatever was wrong with it. Other modules call
 * this at the top of every handler that needs a signed-in user.
 */
export async function requireSession(
  request: { readonly headers: { readonly authorization?: string | undefined } },
  context: { readonly tenants: TenantDatabase; readonly clock: Clock },
): Promise<Session> {
  const token = bearerToken(request.headers.authorization);
  const session =
    token === undefined
      ? undefined
      : await authenticateSession(context.tenants, token, context.clock);
  if (session === undefined) {
    throw new ProblemError(accessProblemCodes.sessionRequired, 401, {
      title: "Sign in to continue",
    });
  }
  return session;
}
