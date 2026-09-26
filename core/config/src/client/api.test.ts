import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  apiBlob,
  ApiProblem,
  apiRequest,
  configureApi,
  hasSessionCredential,
  holdDeviceCredential,
  holdSession,
  forgetSession,
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
