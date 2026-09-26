// @vitest-environment jsdom
import { createHash } from "node:crypto";
import {
  acceptBundle,
  type AuditSink,
  type BundleVerifier,
  ClientRuntimeProvider,
  configLocalMigrations,
  configureApi,
  type DeviceAuditEvent,
} from "@mustawfi/core-config/client";
import { BUNDLE_ALGORITHM, BUNDLE_TYPE, signedBundleSchema } from "@mustawfi/core-config/shared";
import { createI18n } from "@mustawfi/i18n";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import {
  type LocalDb,
  LocalDbProvider,
  migrateLocalDb,
  touchesLocalTables,
} from "@mustawfi/local-db";
import { openNodeLocalDb } from "@mustawfi/local-db/node";
import { UI_NAMESPACE, uiMessages } from "@mustawfi/ui";
import { hash } from "@node-rs/argon2";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, renderHook, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompactSign, exportJWK, generateKeyPair } from "jose";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessPart } from "../../shared/index.ts";
import { accessBundlePart } from "../bundle-part.ts";
import { accessLocalMigrations } from "../device.ts";
import { ACCESS_NAMESPACE, accessMessages } from "../messages.ts";
import { useAutoLock } from "./auto-lock.ts";
import { lastActivityAt, localSession, pinLocalMigrations } from "./local-sign-in.ts";
import { PinScreen } from "./pin-screen.tsx";

const i18n = createI18n({ [UI_NAMESPACE]: uiMessages, [ACCESS_NAMESPACE]: accessMessages });

const TENANT = "0199a000-0000-7000-8000-000000000001";
const DEVICE = "0199a000-0000-7000-8000-0000000000d1";
const CASHIER = "0199a000-0000-7000-8000-0000000000b1";
const ACCOUNTANT = "0199a000-0000-7000-8000-0000000000b2";
const OWNER = "0199a000-0000-7000-8000-0000000000b3";
const WITHOUT_PIN = "0199a000-0000-7000-8000-0000000000b4";

const clock = manualClock(new Date("2026-09-26T07:00:00.000Z"));
let verifier: BundleVerifier;
let signedBundle: string;

beforeAll(async () => {
  const role = (id: string, name: string, isOwner: boolean, permissions: string[]) => ({
    id,
    name,
    isOwner,
    permissions,
    limits: {},
  });
  const user = async (id: string, name: string, roleId: string, pin: string | null) => ({
    id,
    name,
    roleId,
    departmentScope: "all" as const,
    departments: [],
    pinVerifier: pin === null ? null : await hash(pin, { algorithm: 2 }),
    pinChangedAt: pin === null ? null : "2026-09-20T08:00:00.000Z",
  });
  const access: AccessPart = {
    catalogue: { permissions: [], limits: [] },
    roles: [
      role("0199a000-0000-7000-8000-0000000000a1", "المالك", true, []),
      role("0199a000-0000-7000-8000-0000000000a2", "كاشير القسم", false, []),
      role("0199a000-0000-7000-8000-0000000000a3", "المحاسب", false, ["access.users.unlock"]),
    ],
    users: await Promise.all([
      user(OWNER, "هدى", "0199a000-0000-7000-8000-0000000000a1", "4826"),
      user(CASHIER, "سامر", "0199a000-0000-7000-8000-0000000000a2", "2580"),
      user(ACCOUNTANT, "ليلى", "0199a000-0000-7000-8000-0000000000a3", "7391"),
      user(WITHOUT_PIN, "باسل", "0199a000-0000-7000-8000-0000000000a2", null),
    ]),
  };
  const { privateKey, publicKey } = await generateKeyPair(BUNDLE_ALGORITHM, {
    crv: "Ed25519",
    extractable: true,
  });
  const { x } = await exportJWK(publicKey);
  if (x === undefined) throw new Error("no public key");
  verifier = { keys: { "test-bundle": x }, decoders: [accessBundlePart] };
  const text = JSON.stringify(access);
  const manifest = {
    version: 1,
    issuedAt: clock.now().toISOString(),
    deviceId: DEVICE,
    licenseRef: "0199a000-0000-7000-8000-0000000000c1",
    parts: { access: createHash("sha256").update(text, "utf8").digest("base64url") },
  };
  const jws = await new CompactSign(new Uint8Array(Buffer.from(JSON.stringify(manifest))))
    .setProtectedHeader({ alg: BUNDLE_ALGORITHM, typ: BUNDLE_TYPE, kid: "test-bundle" })
    .sign(privateKey);
  signedBundle = JSON.stringify({ manifest: jws, parts: { access: text } });
});

let db: LocalDb;
let audited: DeviceAuditEvent[];
const sink: AuditSink = {
  record: (_tx, event) => {
    audited.push(event);
    return Promise.resolve();
  },
};

beforeEach(async () => {
  configureApi({ origin: "", session: "cookie" });
  db = openNodeLocalDb(":memory:");
  await migrateLocalDb(db, [
    ...accessLocalMigrations,
    ...configLocalMigrations,
    ...pinLocalMigrations,
  ]);
  await db.run(
    `INSERT INTO access_device (id, tenant_id, prefix, name, type, credential, base_currency, registered_at)
     VALUES (?, ?, 'K7', 'الصندوق', 'mainPos', 'd1.credential', 'SYP', ?)`,
    [DEVICE, TENANT, clock.now().toISOString()],
  );
  await acceptBundle(
    db,
    { version: 1, bundle: signedBundleSchema.parse(JSON.parse(signedBundle)) },
    verifier,
    { deviceId: DEVICE, tenantId: TENANT },
    clock,
  );
  audited = [];
  // The server is out of reach: every PIN is checked on the device.
  vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await db.close();
});

function renderPinScreen(props: { readonly reconnect?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  db.subscribe((tables) => {
    void queryClient.invalidateQueries({
      predicate: (query) => touchesLocalTables(query.meta, tables),
    });
  });
  const onSignedIn = vi.fn();
  const runtime = {
    clock,
    newId: uuidV7Generator({ clock, random: cryptoRandom }),
    audit: sink,
  };
  render(
    <I18nextProvider i18n={i18n}>
      <ClientRuntimeProvider runtime={runtime}>
        <LocalDbProvider db={db}>
          <QueryClientProvider client={queryClient}>
            <PinScreen
              bundleVerifier={verifier}
              reconnect={props.reconnect === true}
              passwordLink={(label) => <a href="/login">{label}</a>}
              onSignedIn={onSignedIn}
            />
          </QueryClientProvider>
        </LocalDbProvider>
      </ClientRuntimeProvider>
    </I18nextProvider>,
  );
  return { onSignedIn };
}

describe("the PIN screen (flows 12–13)", () => {
  it("shows the users with a PIN as name tiles, by name, the first with focus", async () => {
    renderPinScreen();
    const tiles = await screen.findByRole("list", { name: "المستخدمون على هذا الجهاز" });
    expect(
      within(tiles)
        .getAllByRole("button")
        .map((tile) => tile.textContent),
    ).toEqual(["سامركاشير القسم", "ليلىالمحاسب", "هدىالمالك"]);
    expect(within(tiles).getAllByRole("button")[0]).toHaveFocus();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("من يستخدم الجهاز؟");
    expect(screen.getByRole("link", { name: "الدخول بكلمة المرور" })).toBeInTheDocument();
  });

  it("keyboard only: a name, the PIN's digits, Enter — five wrong lock the name; a supervisor unlocks with the pad", async () => {
    const user = userEvent.setup();
    const { onSignedIn } = renderPinScreen();
    await screen.findByRole("list", { name: "المستخدمون على هذا الجهاز" });
    await user.keyboard("{Enter}");
    const field = await screen.findByLabelText("الرمز السري لـ سامر");
    expect(field).toHaveFocus();

    for (const left of ["بقيت 4 محاولات", "بقيت 3 محاولات", "بقيت محاولتان", "بقيت محاولة واحدة"]) {
      await user.keyboard("0000{Enter}");
      expect(await screen.findByRole("alert")).toHaveTextContent(left);
      expect(field).toHaveValue("");
      expect(field).toHaveFocus();
    }
    await user.keyboard("0000{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "أُقفل سامر على هذا الجهاز بعد خمس محاولات خاطئة.",
    );
    // Locked: the right PIN is not even checked.
    await user.keyboard("2580{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("سامر مقفل على هذا الجهاز");
    expect(onSignedIn).not.toHaveBeenCalled();

    // Back on the tiles, the name says it is locked, in words.
    await user.keyboard("{Escape}");
    const tiles = await screen.findByRole("list", { name: "المستخدمون على هذا الجهاز" });
    expect(within(tiles).getByRole("button", { name: /سامر/ })).toHaveTextContent(
      "مقفل على هذا الجهاز",
    );

    await user.click(within(tiles).getByRole("button", { name: /سامر/ }));
    await user.click(await screen.findByRole("button", { name: "فتح القفل بواسطة مشرف" }));
    const supervisors = await screen.findByRole("list", { name: "المشرفون على هذا الجهاز" });
    // Those whose role may unlock: the accountant (access.users.unlock) and the owner.
    expect(
      within(supervisors)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["ليلىالمحاسب", "هدىالمالك"]);
    await user.click(within(supervisors).getByRole("button", { name: /ليلى/ }));
    const pad = await screen.findByRole("group", { name: "لوحة الأرقام" });
    for (const digit of ["7", "3", "9", "1"]) {
      await user.click(within(pad).getByRole("button", { name: digit }));
    }
    expect(screen.getByLabelText("رمز المشرف ليلى")).toHaveFocus();
    await user.click(within(pad).getByRole("button", { name: "دخول" }));
    expect(await screen.findByRole("status")).toHaveTextContent("فُتح قفل سامر");

    await user.keyboard("2580{Enter}");
    await vi.waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledWith(null);
    });
    expect(await localSession(db)).toMatchObject({ userId: CASHIER, serverSession: false });
    expect(audited.map((event) => [event.action, event.userId])).toEqual([
      ...Array.from({ length: 5 }, () => ["access.pin.failed", CASHIER]),
      ["access.pin.lockedOut", CASHIER],
      ["access.pin.unlocked", ACCOUNTANT],
      ["access.pin.signedIn", CASHIER],
    ]);
  });

  it("asks the signed-in user alone for their PIN on a reconnect, and waits for the server (rule 25)", async () => {
    await db.run(
      `INSERT INTO access_local_session (id, user_id, tenant_id, method, opened_at, server_session)
       VALUES (1, ?, ?, 'pin', ?, 0)`,
      [CASHIER, TENANT, clock.now().toISOString()],
    );
    const user = userEvent.setup();
    const { onSignedIn } = renderPinScreen({ reconnect: true });
    const field = await screen.findByLabelText("الرمز السري لـ سامر");
    expect(field).toHaveFocus();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    await user.keyboard("2580{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("لا اتصال بالخادم");
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(audited).toEqual([]);
  });
});

describe("auto-lock (rule 24)", () => {
  it("locks after the idle time without input, and input starts it over", async () => {
    vi.useFakeTimers();
    const at = manualClock(new Date("2026-09-26T07:00:00.000Z"));
    const onLock = vi.fn();
    renderHook(() => {
      useAutoLock({ db, clock: at, idleMs: 5 * 60_000, enabled: true, onLock });
    });
    const pass = async (ms: number) => {
      at.advance(ms);
      await act(() => vi.advanceTimersByTimeAsync(ms));
    };
    await pass(4 * 60_000);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    await pass(4 * 60_000);
    expect(onLock).not.toHaveBeenCalled();
    // Input is written to the database now and then, so a restart knows the idle time too.
    await vi.waitFor(async () => {
      expect(await lastActivityAt(db)).toBe(new Date("2026-09-26T07:04:00.000Z").getTime());
    });
    await pass(60_000 + 5_000);
    expect(onLock).toHaveBeenCalledOnce();
  });

  it("never locks a client with nobody signed in on the device", async () => {
    vi.useFakeTimers();
    const at = manualClock(new Date("2026-09-26T07:00:00.000Z"));
    const onLock = vi.fn();
    renderHook(() => {
      useAutoLock({ db, clock: at, idleMs: 5 * 60_000, enabled: false, onLock });
    });
    at.advance(60 * 60_000);
    await act(() => vi.advanceTimersByTimeAsync(60 * 60_000));
    expect(onLock).not.toHaveBeenCalled();
  });
});
