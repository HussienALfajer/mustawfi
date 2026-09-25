import type { z } from "zod";
import { hostProblemCodes, problemDetailsSchema } from "../shared/index.ts";

export { type ClientRuntime, ClientRuntimeProvider, useClientRuntime } from "./runtime.tsx";

/** The API answered with problem details; `code` picks the Arabic message (ADR-0014). */
export class ApiProblem extends Error {
  override name = "ApiProblem";
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(`${String(status)} ${code}`);
    this.code = code;
    this.status = status;
  }
}

/** The request never got an answer: offline, or the server is down. */
export class ApiUnreachable extends Error {
  override name = "ApiUnreachable";
}

export interface ApiRequest<T> {
  readonly method?: "GET" | "POST";
  /** Sent as JSON. */
  readonly body?: unknown;
  /** Validates the answer: a response that does not match is a bug, not data. */
  readonly schema: z.ZodType<T>;
  readonly signal?: AbortSignal;
  /**
   * A bearer credential: a registered device's, for sync (ADR-0022). Without it the request
   * carries the session cookie.
   */
  readonly bearer?: string;
}

/**
 * Calls the tenant API from the browser, on the page's own origin, with the session cookie
 * (ADR-0022). A problem-details answer throws `ApiProblem`; no answer throws `ApiUnreachable`.
 */
export async function apiRequest<T>(path: string, request: ApiRequest<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: request.method ?? "GET",
      credentials: "same-origin",
      headers: {
        ...(request.body === undefined ? {} : { "content-type": "application/json" }),
        ...(request.bearer === undefined ? {} : { authorization: `Bearer ${request.bearer}` }),
      },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiUnreachable("the API did not answer", { cause: error });
  }
  if (response.status === 204) return request.schema.parse(null);
  const json: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const problem = problemDetailsSchema.safeParse(json);
    // A gateway answering for a server that is down is no answer from the API.
    if (!problem.success && response.status >= 502) {
      throw new ApiUnreachable(`the gateway answered ${String(response.status)}`);
    }
    throw new ApiProblem(
      problem.success ? problem.data.code : hostProblemCodes.internal,
      response.status,
    );
  }
  return request.schema.parse(json);
}
