import { ApiProblem, apiRequest } from "@mustawfi/core-config/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { accessProblemCodes, currentSessionSchema, loginResponseSchema } from "../shared/index.ts";

export type CurrentSession = z.infer<typeof currentSessionSchema>;

export const sessionQueryKey = ["access", "session"] as const;

/** The signed-in session, or `null` when there is none (a 401). */
export async function fetchSession(signal?: AbortSignal): Promise<CurrentSession | null> {
  try {
    return await apiRequest("/api/v1/access/session", {
      schema: currentSessionSchema,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (error instanceof ApiProblem && error.code === accessProblemCodes.sessionRequired) {
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
}

/** Signs in with the browser transport: the server sets an `HttpOnly` cookie (ADR-0022). */
export async function signIn(input: SignInInput): Promise<CurrentSession> {
  const answer = await apiRequest("/api/v1/access/login", {
    method: "POST",
    body: { ...input, transport: "cookie" },
    schema: loginResponseSchema,
  });
  return { tenantId: answer.tenantId, expiresAt: answer.expiresAt, user: answer.user };
}

/** Ends the session on the server, which also clears the cookie. */
export async function signOut(): Promise<void> {
  try {
    await apiRequest("/api/v1/access/logout", { method: "POST", schema: z.null() });
  } catch (error) {
    // Already signed out (expired or revoked elsewhere): the goal is reached.
    if (error instanceof ApiProblem && error.code === accessProblemCodes.sessionRequired) return;
    throw error;
  }
}
