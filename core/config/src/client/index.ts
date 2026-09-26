import type { z } from "zod";
import {
  DEVICE_CREDENTIAL_HEADER,
  hostProblemCodes,
  problemDetailsSchema,
} from "../shared/index.ts";

export {
  acceptBundle,
  type BundleDevice,
  type BundleOutcome,
  type BundlePartDecoder,
  type BundleRefusal,
  BundleRefusedError,
  type BundleStatus,
  bundleStatus,
  bundleStatusQueryOptions,
  type BundleVerifier,
  CONFIG_BUNDLE_REFUSAL_TABLE,
  CONFIG_BUNDLE_TABLE,
  configLocalMigrations,
  type LoadedBundle,
  loadBundle,
  loadedBundleQueryOptions,
  storedBundleVersion,
  type VerifiedBundle,
  verifyBundle,
  verifyServerTime,
} from "./bundle.ts";
export {
  type AuditSink,
  type DeviceAuditEvent,
  type DeviceAuditValue,
  type DeviceAuditValues,
} from "./audit.ts";
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
/**
 * Whether this client holds a session: for the cookie transport, whether requests carry the
 * cookie. The page never sees the cookie, so a registered device that ends its user's session
 * offline (a lock, `core-foundation` rule 24) stops sending it until the next sign-in sets a new
 * one — a cookie left from one user must never act for the next (rule 25).
 */
let sessionHeld = true;
let deviceCredential: string | undefined;

export function configureApi(next: ApiEndpoint): void {
  endpoint = next;
  sessionBearer = undefined;
  sessionHeld = next.session === "cookie";
}

/** How this client's session travels: the login asks the server for that transport. */
export function sessionTransport(): ApiEndpoint["session"] {
  return endpoint.session;
}

/**
 * Keeps the session a sign-in just opened: the bearer transport's token, or — for the cookie
 * transport, whose answer carries no token — the cookie the answer set.
 */
export function holdSession(token: string | undefined): void {
  sessionBearer = token;
  sessionHeld = endpoint.session === "cookie" || token !== undefined;
}

/** Forgets the session: the held token, or the cookie until a sign-in sets a new one. */
export function forgetSession(): void {
  sessionBearer = undefined;
  sessionHeld = false;
}

/**
 * Keeps (or forgets) this client's device credential once it is a registered device: every
 * request made with the session then carries it in `Mustawfi-Device`, since a session opened on
 * a device is accepted only with that device's credential (`core-foundation` rule 22).
 */
export function holdDeviceCredential(credential: string | undefined): void {
  deviceCredential = credential;
}

/** Whether this client holds a session: a bearer token, or a cookie it has not forgotten. */
export function hasSessionCredential(): boolean {
  return endpoint.session === "cookie" ? sessionHeld : sessionBearer !== undefined;
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
  /**
   * A sign-in: its answer sets the session cookie, which the browser keeps only from a request
   * that may carry cookies — even while this client holds no session.
   */
  readonly opensSession?: boolean;
}

/** Sends a request with the session (or `bearer`); no answer throws `ApiUnreachable`. */
async function send(path: string, request: Omit<ApiRequest<unknown>, "schema">): Promise<Response> {
  const bearer = request.bearer ?? (endpoint.session === "bearer" ? sessionBearer : undefined);
  // A request with its own bearer (sync) is the device itself; the session's go with it.
  const device = request.bearer === undefined ? deviceCredential : undefined;
  try {
    return await (request.fetch ?? fetch)(`${endpoint.origin}${path}`, {
      method: request.method ?? "GET",
      // Another origin never receives the browser's cookies, and a forgotten session's cookie
      // goes nowhere until a sign-in replaces it.
      credentials:
        endpoint.origin === "" && (sessionHeld || request.opensSession === true)
          ? "same-origin"
          : "omit",
      headers: {
        ...(request.body === undefined ? {} : { "content-type": "application/json" }),
        ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
        ...(device === undefined ? {} : { [DEVICE_CREDENTIAL_HEADER]: device }),
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
