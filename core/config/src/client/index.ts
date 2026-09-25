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

/**
 * Where the API is and how the session travels (ADR-0022), set once by the app's composition
 * root. The browser calls its own origin and the session is an `HttpOnly` cookie; the Windows
 * app is served from its own origin, so it calls the server's origin and sends the session as
 * a bearer token, which it holds in memory only (the OS secure store comes later).
 */
export interface ApiEndpoint {
  /** The server's origin, `https://…`; `""` for the page's own origin. */
  readonly origin: string;
  readonly session: "cookie" | "bearer";
}

let endpoint: ApiEndpoint = { origin: "", session: "cookie" };
let sessionBearer: string | undefined;

export function configureApi(next: ApiEndpoint): void {
  endpoint = next;
  sessionBearer = undefined;
}

/** How this client's session travels: the login asks the server for that transport. */
export function sessionTransport(): ApiEndpoint["session"] {
  return endpoint.session;
}

/** Keeps (or, with `undefined`, forgets) the session token of the bearer transport. */
export function holdSessionToken(token: string | undefined): void {
  sessionBearer = token;
}

/** Whether a bearer-transport client holds a session token; always true for the cookie. */
export function hasSessionCredential(): boolean {
  return endpoint.session === "cookie" || sessionBearer !== undefined;
}

export interface ApiRequest<T> {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Sent as JSON. */
  readonly body?: unknown;
  /** Validates the answer: a response that does not match is a bug, not data. */
  readonly schema: z.ZodType<T>;
  readonly signal?: AbortSignal;
  /**
   * A bearer credential: a registered device's, for sync (ADR-0022). Without it the request
   * carries the session: the cookie, or the held session token.
   */
  readonly bearer?: string;
  /**
   * How the request travels; the platform `fetch` by default. A shell or the sync simulation
   * harness (ADR-0026) passes its own.
   */
  readonly fetch?: typeof fetch;
}

/** Sends a request with the session (or `bearer`); no answer throws `ApiUnreachable`. */
async function send(path: string, request: Omit<ApiRequest<unknown>, "schema">): Promise<Response> {
  const bearer = request.bearer ?? (endpoint.session === "bearer" ? sessionBearer : undefined);
  try {
    return await (request.fetch ?? fetch)(`${endpoint.origin}${path}`, {
      method: request.method ?? "GET",
      // Another origin never receives the browser's cookies.
      credentials: endpoint.origin === "" ? "same-origin" : "omit",
      headers: {
        ...(request.body === undefined ? {} : { "content-type": "application/json" }),
        ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
      },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiUnreachable("the API did not answer", { cause: error });
  }
}

/** Throws what an answer that is not OK means: its problem, or no answer from the API. */
async function refuse(response: Response): Promise<never> {
  const json: unknown = await response.json().catch(() => undefined);
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

/**
 * Calls the tenant API at the configured endpoint (`configureApi`), with the session (ADR-0022).
 * A problem-details answer throws `ApiProblem`; no answer throws `ApiUnreachable`.
 */
export async function apiRequest<T>(path: string, request: ApiRequest<T>): Promise<T> {
  const response = await send(path, request);
  if (response.status === 204) return request.schema.parse(null);
  if (!response.ok) return refuse(response);
  const json: unknown = await response.json().catch(() => undefined);
  return request.schema.parse(json);
}

/**
 * Fetches a binary resource (an image) from the tenant API with the session, as a `Blob`: an
 * `<img>` cannot carry the Windows app's bearer token. Refusals throw like `apiRequest`'s.
 */
export async function apiBlob(
  path: string,
  request: Pick<ApiRequest<Blob>, "signal" | "fetch"> = {},
): Promise<Blob> {
  const response = await send(path, request);
  if (!response.ok) return refuse(response);
  return response.blob();
}
