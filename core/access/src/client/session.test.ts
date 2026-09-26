import { configureApi } from "@mustawfi/core-config/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accessProblemCodes } from "../shared/index.ts";
import { fetchSession, signIn, signOut } from "./session.ts";

const ORIGIN = "http://127.0.0.1:3000";
const user = {
  id: "01a0d90e-748c-76c0-b21b-4d7397dd2705",
  name: "سامر",
  login: "owner",
  role: { id: "01a0d90e-748c-76c0-b21b-4d7397dd2706", name: "المالك", isOwner: true },
  departmentScope: "all",
  departments: [],
  permissions: ["organization.profile.edit"],
};
const session = {
  tenantId: "01a0d90e-759f-7223-90eb-cee31ed7e07c",
  expiresAt: "2026-10-02T00:00:00.000Z",
  user,
  license: {
    state: "active",
    expiresAt: "2027-09-25T08:00:00.000Z",
    readOnlyAt: "2027-10-02T08:00:00.000Z",
    suspendedAt: "2027-11-01T08:00:00.000Z",
  },
};

interface Call {
  readonly url: string;
  readonly body: unknown;
  readonly authorization: string | undefined;
}

/** A stand-in server: sign-in issues `s1.token` (bearer) or nothing (cookie). */
function fakeServer(): Call[] {
  const calls: Call[] = [];
  // `apiRequest` passes the URL and a JSON body as strings.
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body: unknown = init.body === undefined ? undefined : JSON.parse(init.body as string);
    calls.push({ url, body, authorization: headers["authorization"] });
    if (url.endsWith("/login")) {
      const transport = (body as { transport: string }).transport;
      return Promise.resolve(
        Response.json({ ...session, ...(transport === "bearer" ? { token: "s1.token" } : {}) }),
      );
    }
    if (url.endsWith("/logout")) return Promise.resolve(new Response(null, { status: 204 }));
    if (headers["authorization"] === "Bearer s1.token") {
      return Promise.resolve(Response.json(session));
    }
    return Promise.resolve(
      Response.json(
        {
          type: "about:blank",
          title: "Session required",
          status: 401,
          code: accessProblemCodes.sessionRequired,
        },
        { status: 401 },
      ),
    );
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  configureApi({ origin: "", session: "cookie" });
});

const credentials = { storeCode: "AB2CD3", login: "owner", password: "secret" };

describe("the Windows app's session (bearer transport, ADR-0022)", () => {
  it("asks for a token, holds it for later calls, and forgets it on sign-out", async () => {
    configureApi({ origin: ORIGIN, session: "bearer" });
    const calls = fakeServer();

    expect(await fetchSession()).toBeNull();
    // Without a token nothing is asked of the server: the answer is known.
    expect(calls).toEqual([]);

    await signIn(credentials);
    expect(calls[0]).toMatchObject({
      url: `${ORIGIN}/api/v1/access/login`,
      body: { ...credentials, transport: "bearer" },
    });
    expect(await fetchSession()).toEqual(session);
    expect(calls[1]?.authorization).toBe("Bearer s1.token");

    await signOut();
    expect(calls[2]).toMatchObject({
      url: `${ORIGIN}/api/v1/access/logout`,
      authorization: "Bearer s1.token",
    });
    expect(await fetchSession()).toBeNull();
    expect(calls).toHaveLength(3);
  });

  it("forgets a token the server no longer accepts", async () => {
    configureApi({ origin: ORIGIN, session: "bearer" });
    const calls = fakeServer();
    await signIn(credentials);
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        Response.json(
          {
            type: "about:blank",
            title: "Session required",
            status: 401,
            code: accessProblemCodes.sessionRequired,
          },
          { status: 401 },
        ),
      ),
    );
    expect(await fetchSession()).toBeNull();
    const after = fakeServer();
    expect(await fetchSession()).toBeNull();
    expect(after).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe("the browser's session (cookie transport)", () => {
  it("asks for a cookie and sends no bearer", async () => {
    const calls = fakeServer();
    await signIn(credentials);
    expect(calls[0]).toMatchObject({
      url: "/api/v1/access/login",
      body: { ...credentials, transport: "cookie" },
      authorization: undefined,
    });
    await fetchSession().catch(() => undefined);
    expect(calls[1]?.authorization).toBeUndefined();
  });
});
