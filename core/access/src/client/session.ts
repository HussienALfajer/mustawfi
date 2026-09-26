import {
  ApiProblem,
  apiRequest,
  hasSessionCredential,
  holdSessionToken,
  sessionTransport,
} from "@mustawfi/core-config/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { accessProblemCodes, currentSessionSchema, loginResponseSchema } from "../shared/index.ts";

export type CurrentSession = z.infer<typeof currentSessionSchema>;

export const sessionQueryKey = ["access", "session"] as const;

/** The signed-in session, or `null` when there is none (a 401, or no token held). */
export async function fetchSession(signal?: AbortSignal): Promise<CurrentSession | null> {
  if (!hasSessionCredential()) return null;
  try {
    return await apiRequest("/api/v1/access/session", {
      schema: currentSessionSchema,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (error instanceof ApiProblem && error.code === accessProblemCodes.sessionRequired) {
      holdSessionToken(undefined);
      return null;
    }
    throw error;
  }
}

/** The session as TanStack Query caches it; route guards read it before rendering. */
export function sessionQueryOptions() {
  return queryOptions({
    queryKey: sessionQueryKey,
    queryFn: ({ signal }) => fetchSession(signal),
    staleTime: 60_000,
    retry: false,
  });
}

export interface SignInInput {
  readonly storeCode: string;
  readonly login: string;
  readonly password: string;
  /** The authenticator app's code or a recovery code, once the server asked for it. */
  readonly secondFactor?: string | undefined;
}

/**
 * Signs in with this client's session transport (ADR-0022): in the browser the server sets an
 * `HttpOnly` cookie; the Windows app receives the token and holds it.
 */
export async function signIn(input: SignInInput): Promise<CurrentSession> {
  const transport = sessionTransport();
  const answer = await apiRequest("/api/v1/access/login", {
    method: "POST",
    body: {
      storeCode: input.storeCode,
      login: input.login,
      password: input.password,
      ...(input.secondFactor === undefined ? {} : { secondFactor: input.secondFactor }),
      transport,
    },
    schema: loginResponseSchema,
  });
  if (transport === "bearer") {
    if (answer.token === undefined) throw new Error("the bearer sign-in returned no token");
    holdSessionToken(answer.token);
  }
  return { tenantId: answer.tenantId, expiresAt: answer.expiresAt, user: answer.user };
}

export interface PasswordResetInput {
  readonly storeCode: string;
  readonly login: string;
  /** The one-time code Vertex support gave the owner. */
  readonly code: string;
  readonly password: string;
  readonly pin?: string | undefined;
}

/** Sets an owner's new password with a support reset code (`core-foundation` rule 27). */
export async function resetPasswordWithCode(input: PasswordResetInput): Promise<void> {
  await apiRequest("/api/v1/access/password-reset", {
    method: "POST",
    body: {
      storeCode: input.storeCode,
      login: input.login,
      code: input.code,
      password: input.password,
      ...(input.pin === undefined ? {} : { pin: input.pin }),
    },
    schema: z.null(),
  });
}

/** Ends the session on the server, which also clears the cookie, and forgets a held token. */
export async function signOut(): Promise<void> {
  try {
    await apiRequest("/api/v1/access/logout", { method: "POST", schema: z.null() });
  } catch (error) {
    // Already signed out (expired or revoked elsewhere): the goal is reached.
    if (error instanceof ApiProblem && error.code === accessProblemCodes.sessionRequired) {
      holdSessionToken(undefined);
      return;
    }
    throw error;
  }
  holdSessionToken(undefined);
}
