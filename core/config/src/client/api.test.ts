import { memorySecureStore, type SecureStore } from "@mustawfi/keystore";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  apiBlob,
  ApiProblem,
  apiRequest,
  ApiUnreachable,
  configureApi,
  hasSessionCredential,
  holdDeviceCredential,
  holdSession,
  forgetSession,
  restoreSession,
  sessionKept,
} from "./index.ts";

interface Sent {
  readonly url: string;
  readonly init: RequestInit;
}

/** A `fetch` that records what it was asked and answers `{ ok: true }`. */
function recordingFetch(): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  // `apiRequest` always passes the URL as a string.
  const fake = (url: string, init: RequestInit = {}) => {
    sent.push({ url, init });
    return Promise.resolve(Response.json({ ok: true }));
  };
  return { fetch: fake as unknown as typeof fetch, sent };
}

const okSchema = z.object({ ok: z.literal(true) });

function authorization(sent: Sent | undefined): string | undefined {
  return (sent?.init.headers as Record<string, string> | undefined)?.["authorization"];
}

function deviceHeader(sent: Sent | undefined): string | undefined {
  return (sent?.init.headers as Record<string, string> | undefined)?.["mustawfi-device"];
}

afterEach(() => {
  configureApi({ origin: "", session: "cookie" });
  holdDeviceCredential(undefined);
});

describe("the device credential beside the session (core-foundation rule 22)", () => {
  it("goes with every session request of a registered client, in both transports", async () => {
    const { fetch, sent } = recordingFetch();
    await apiRequest("/api/v1/access/session", { schema: okSchema, fetch });
    expect(deviceHeader(sent[0])).toBeUndefined();

    holdDeviceCredential("d1.device");
    await apiRequest("/api/v1/access/session", { schema: okSchema, fetch });
    expect(deviceHeader(sent[1])).toBe("d1.device");

    configureApi({ origin: "http://127.0.0.1:3000", session: "bearer" });
    holdSession("s1.session");
    await apiRequest("/api/v1/access/login", { method: "POST", body: {}, schema: okSchema, fetch });
    expect(deviceHeader(sent[2])).toBe("d1.device");
    expect(authorization(sent[2])).toBe("Bearer s1.session");
  });

  it("is not added to a request that carries its own bearer (sync, as the device itself)", async () => {
    holdDeviceCredential("d1.device");
    const { fetch, sent } = recordingFetch();
    await apiRequest("/api/v1/sync/pull", { schema: okSchema, fetch, bearer: "d1.device" });
    expect(deviceHeader(sent[0])).toBeUndefined();
  });
});

describe("apiRequest endpoints (ADR-0022)", () => {
  it("in the browser, calls its own origin with the session cookie and no bearer", async () => {
    configureApi({ origin: "", session: "cookie" });
    holdSession("s1.ignored");
    const { fetch, sent } = recordingFetch();
    await apiRequest("/api/v1/access/session", { schema: okSchema, fetch });
    expect(sent[0]?.url).toBe("/api/v1/access/session");
    expect(sent[0]?.init.credentials).toBe("same-origin");
    expect(authorization(sent[0])).toBeUndefined();
    expect(hasSessionCredential()).toBe(true);
  });

  it("in the Windows app, calls the server's origin with the held token and never cookies", async () => {
    configureApi({ origin: "http://127.0.0.1:3000", session: "bearer" });
    expect(hasSessionCredential()).toBe(false);
    const { fetch, sent } = recordingFetch();
    await apiRequest("/api/v1/access/session", { schema: okSchema, fetch });
    expect(sent[0]?.url).toBe("http://127.0.0.1:3000/api/v1/access/session");
    expect(sent[0]?.init.credentials).toBe("omit");
    expect(authorization(sent[0])).toBeUndefined();

    holdSession("s1.session");
    expect(hasSessionCredential()).toBe(true);
    await apiRequest("/api/v1/access/session", { schema: okSchema, fetch });
    expect(authorization(sent[1])).toBe("Bearer s1.session");

    // A device credential (sync) takes the place of the session token.
    await apiRequest("/api/v1/sync/pull", { schema: okSchema, fetch, bearer: "d1.device" });
    expect(authorization(sent[2])).toBe("Bearer d1.device");

    forgetSession();
    await apiRequest("/api/v1/access/session", { schema: okSchema, fetch });
    expect(authorization(sent[3])).toBeUndefined();
  });

  it("in the browser, sends no cookie once the session is forgotten, until a sign-in sets one (rule 25)", async () => {
    configureApi({ origin: "", session: "cookie" });
    const { fetch, sent } = recordingFetch();
    forgetSession();
    expect(hasSessionCredential()).toBe(false);
    await apiRequest("/api/v1/access/session", { schema: okSchema, fetch });
    expect(sent[0]?.init.credentials).toBe("omit");

    // The sign-in may carry cookies, so the browser keeps the one its answer sets.
    await apiRequest("/api/v1/access/pin-login", {
      method: "POST",
      body: {},
      schema: okSchema,
      fetch,
      opensSession: true,
    });
    expect(sent[1]?.init.credentials).toBe("same-origin");

    holdSession(undefined);
    expect(hasSessionCredential()).toBe(true);
    await apiRequest("/api/v1/access/session", { schema: okSchema, fetch });
    expect(sent[2]?.init.credentials).toBe("same-origin");
  });

  it("forgets a held token when the endpoint is configured again", () => {
    configureApi({ origin: "http://127.0.0.1:3000", session: "bearer" });
    holdSession("s1.session");
    configureApi({ origin: "http://127.0.0.1:3000", session: "bearer" });
    expect(hasSessionCredential()).toBe(false);
  });
});

describe("the session token in the secure store (ADR-0022, core-foundation slice 18)", () => {
  const origin = "http://127.0.0.1:3000";

  it("survives a restart of the Windows app, and a forgotten one does not", async () => {
    const store = memorySecureStore();
    configureApi({ origin, session: "bearer", secureStore: store });
    holdSession("s1.session");
    await sessionKept();
    expect(store.secrets.get("sessionToken")).toBe("s1.session");

    // The next run starts with nothing in memory, and takes the token back from the store.
    configureApi({ origin, session: "bearer", secureStore: store });
    expect(hasSessionCredential()).toBe(false);
    await restoreSession();
    expect(hasSessionCredential()).toBe(true);
    const { fetch, sent } = recordingFetch();
    await apiRequest("/api/v1/access/session", { schema: okSchema, fetch });
    expect(authorization(sent[0])).toBe("Bearer s1.session");

    forgetSession();
    await sessionKept();
    expect(store.secrets.has("sessionToken")).toBe(false);
    configureApi({ origin, session: "bearer", secureStore: store });
    await restoreSession();
    expect(hasSessionCredential()).toBe(false);
  });

  it("keeps the last of several changes, in the order they were made", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = memorySecureStore();
    const store: SecureStore = {
      ...slow,
      // The first write is still on its way when the next ones are asked for.
      set: async (name, value) => {
        if (value === "s1.first") await gate;
        await slow.set(name, value);
      },
    };
    configureApi({ origin, session: "bearer", secureStore: store });
    holdSession("s1.first");
    forgetSession();
    holdSession("s1.second");
    release();
    await sessionKept();
    expect(slow.secrets.get("sessionToken")).toBe("s1.second");
  });

  it("holds the session in memory when the store fails, and restores none it cannot read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken: SecureStore = {
      get: () => Promise.reject(new Error("locked")),
      set: () => Promise.reject(new Error("locked")),
      delete: () => Promise.reject(new Error("locked")),
    };
    configureApi({ origin, session: "bearer", secureStore: broken });
    holdSession("s1.session");
    await sessionKept();
    expect(hasSessionCredential()).toBe(true);
    configureApi({ origin, session: "bearer", secureStore: broken });
    await restoreSession();
    expect(hasSessionCredential()).toBe(false);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("is never written for the browser's cookie session", async () => {
    const store = memorySecureStore();
    configureApi({ origin: "", session: "cookie", secureStore: store });
    holdSession(undefined);
    forgetSession();
    await restoreSession();
    await sessionKept();
    expect(store.secrets.size).toBe(0);
    expect(hasSessionCredential()).toBe(false);
  });
});

describe("an answer cut off by a timeout (QA slice 23)", () => {
  it("is no answer, not a malformed one: the headers came, the body never did", async () => {
    configureApi({ origin: "", session: "cookie" });
    // The status and headers arrive, then the link goes silent until the request is aborted.
    const stalled: typeof fetch = (_input, init) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener("abort", () => {
                controller.error(init.signal?.reason as Error);
              });
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    await expect(
      apiRequest("/api/v1/sync/pull", {
        schema: z.object({}),
        fetch: stalled,
        signal: AbortSignal.timeout(20),
      }),
    ).rejects.toBeInstanceOf(ApiUnreachable);
  });
});

describe("apiBlob", () => {
  it("fetches bytes with the held bearer token, which an <img> could not send", async () => {
    configureApi({ origin: "https://store.example", session: "bearer" });
    holdSession("s1.token");
    const sent: Sent[] = [];
    const fake = (url: string, init: RequestInit = {}) => {
      sent.push({ url, init });
      return Promise.resolve(new Response(new Uint8Array([0x89, 0x50]), { status: 200 }));
    };
    const blob = await apiBlob("/api/v1/organization/profile/logo", {
      fetch: fake as unknown as typeof fetch,
    });
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50]));
    expect(sent[0]?.url).toBe("https://store.example/api/v1/organization/profile/logo");
    expect(authorization(sent[0])).toBe("Bearer s1.token");
  });

  it("throws the problem of a refusal", async () => {
    const fake = () =>
      Promise.resolve(
        Response.json(
          { type: "about:blank", title: "none", status: 404, code: "organization.logo.notFound" },
          { status: 404 },
        ),
      );
    await expect(
      apiBlob("/api/v1/organization/profile/logo", { fetch: fake as unknown as typeof fetch }),
    ).rejects.toEqual(new ApiProblem("organization.logo.notFound", 404));
  });
});
