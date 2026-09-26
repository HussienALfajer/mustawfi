// @vitest-environment jsdom
import { createI18n } from "@mustawfi/i18n";
import { UI_NAMESPACE, uiMessages } from "@mustawfi/ui";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceView } from "../../shared/index.ts";
import { ACCESS_NAMESPACE, accessMessages } from "../messages.ts";
import { type CurrentSession, sessionQueryKey } from "../session.ts";
import { DeviceRemovedScreen } from "./device-removed-screen.tsx";
import {
  type DeviceFilters,
  deviceFiltersSchema,
  DevicesScreen,
  filterDevices,
} from "./devices-screen.tsx";
import { formatInstant } from "./devices-table.tsx";

const i18n = createI18n({ [UI_NAMESPACE]: uiMessages, [ACCESS_NAMESPACE]: accessMessages });

function device(id: string, name: string, extra: Partial<DeviceView> = {}): DeviceView {
  return {
    id,
    name,
    type: "mainPos",
    prefix: "K7",
    registeredAt: "2026-09-20T08:00:00.000Z",
    lastSyncAt: "2026-09-26T07:30:00.000Z",
    status: "active",
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    wipedAt: null,
    ...extra,
  };
}

const TILL = device("0190a000-0000-7000-8000-0000000de001", "الصندوق الرئيسي");
const PHONE = device("0190a000-0000-7000-8000-0000000de002", "هاتف المستودع", {
  type: "companion",
  prefix: "M3",
  lastSyncAt: null,
});
const OLD = device("0190a000-0000-7000-8000-0000000de003", "الصندوق القديم", {
  prefix: "Q9",
  status: "revoked",
  revokedAt: "2026-09-25T10:00:00.000Z",
  revokedBy: { id: "0190a000-0000-7000-8000-00000000c001", name: "سامر" },
  revokeReason: "تعطّل",
  wipedAt: "2026-09-25T10:05:00.000Z",
});

describe("device filters", () => {
  it("default to the active devices with no search, and survive a bad URL", () => {
    expect(deviceFiltersSchema.parse({})).toEqual({ status: "active", q: "" });
    expect(deviceFiltersSchema.parse({ status: "gone", q: 1 })).toEqual({
      status: "active",
      q: "",
    });
  });

  it("filter by status, and by name or exact prefix", () => {
    const all = [TILL, PHONE, OLD];
    expect(filterDevices(all, { status: "active", q: "" })).toEqual([TILL, PHONE]);
    expect(filterDevices(all, { status: "revoked", q: "" })).toEqual([OLD]);
    expect(filterDevices(all, { status: "all", q: " الصندوق " })).toEqual([TILL, OLD]);
    expect(filterDevices(all, { status: "all", q: "m3" })).toEqual([PHONE]);
  });
});

/** A fake API: the devices list, and each write answered from `answers`. */
function fakeApi(devices: DeviceView[], answers: Record<string, () => Response> = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({
      method,
      url,
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    const answer = answers[`${method} ${url}`];
    if (answer !== undefined) return Promise.resolve(answer());
    return Promise.resolve(Response.json({ items: devices }));
  });
  return calls;
}

function Screen({
  initial,
  currentDeviceId,
}: {
  readonly initial: Partial<DeviceFilters>;
  readonly currentDeviceId: string | null;
}) {
  const [filters, setFilters] = useState<DeviceFilters>({ status: "active", q: "", ...initial });
  return (
    <>
      <DevicesScreen
        filters={filters}
        onFiltersChange={setFilters}
        currentDeviceId={currentDeviceId}
      />
      <output data-testid="filters">{JSON.stringify(filters)}</output>
    </>
  );
}

function session(permissions: string[]): CurrentSession {
  return {
    tenantId: "0190a000-0000-7000-8000-00000000f001",
    expiresAt: "2026-10-03T08:00:00.000Z",
    user: {
      id: "0190a000-0000-7000-8000-00000000c001",
      name: "سامر",
      login: "owner",
      role: { id: "0190a000-0000-7000-8000-00000000b001", name: "المالك", isOwner: false },
      departmentScope: "all",
      departments: [],
      permissions,
    },
  };
}

function renderScreen({
  initial = {},
  currentDeviceId = null,
  permissions = ["access.devices.manage"],
}: {
  initial?: Partial<DeviceFilters>;
  currentDeviceId?: string | null;
  permissions?: string[];
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(sessionQueryKey, session(permissions));
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <div dir="rtl">
          <Screen initial={initial} currentDeviceId={currentDeviceId} />
        </div>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(cleanup);

describe("DevicesScreen", () => {
  it("lists each device's type, prefix, last sync, and status, marking this one", async () => {
    fakeApi([TILL, PHONE, OLD]);
    renderScreen({ initial: { status: "all" }, currentDeviceId: PHONE.id });
    const table = await screen.findByRole("grid", { name: "الأجهزة" });
    const till = within(table).getByRole("row", { name: /الصندوق الرئيسي/ });
    expect(till).toHaveTextContent("جهاز رئيسي (كاشير)");
    expect(till).toHaveTextContent("K7");
    expect(till).toHaveTextContent(formatInstant(TILL.lastSyncAt ?? ""));
    expect(till).toHaveTextContent("نشط");
    const phone = within(table).getByRole("row", { name: /هاتف المستودع/ });
    expect(phone).toHaveTextContent("هذا الجهاز");
    expect(phone).toHaveTextContent("لم يتزامن بعد");
    expect(within(table).getByRole("row", { name: /الصندوق القديم/ })).toHaveTextContent(
      "مُبطَل، مُسحت بياناته",
    );
    expect(screen.getByText("3 أجهزة")).toBeInTheDocument();
  });

  it("opens a row's panel from the keyboard: focus selects it, even the only row", async () => {
    fakeApi([TILL]);
    renderScreen();
    const table = await screen.findByRole("grid", { name: "الأجهزة" });
    const row = within(table).getByRole("row", { name: /الصندوق الرئيسي/ });
    while (document.activeElement !== row) await userEvent.tab();
    expect(await screen.findByRole("complementary", { name: "الصندوق الرئيسي" })).toBeVisible();
    expect(screen.getByTestId("filters")).toHaveTextContent(TILL.id);
  });

  it("shows a revoked device's revoke: when, by whom, why, and its wipe", async () => {
    fakeApi([OLD]);
    renderScreen({ initial: { status: "revoked", selected: OLD.id } });
    const panel = await screen.findByRole("complementary", { name: "الصندوق القديم" });
    expect(panel).toHaveTextContent("سامر");
    expect(panel).toHaveTextContent("تعطّل");
    expect(panel).toHaveTextContent(`مُسحت في ${formatInstant(OLD.wipedAt ?? "")}`);
    expect(within(panel).queryByRole("button", { name: "إبطال الجهاز" })).toBeNull();
  });

  it("issues a registration code with the store code from a new panel (N)", async () => {
    const calls = fakeApi([TILL], {
      "POST /api/v1/access/registration-codes": () =>
        Response.json(
          { code: "ABCDE-FGHJK", storeCode: "K7M3Q9", expiresAt: "2026-09-26T08:15:00.000Z" },
          { status: 201 },
        ),
    });
    renderScreen();
    await screen.findByRole("grid", { name: "الأجهزة" });
    await userEvent.keyboard("n");
    const panel = await screen.findByRole("complementary", { name: "إضافة جهاز" });
    const issue = within(panel).getByRole("button", { name: "إصدار رمز تسجيل" });
    expect(issue).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(await within(panel).findByTestId("registration-code")).toHaveTextContent("ABCDE-FGHJK");
    expect(within(panel).getByTestId("store-code")).toHaveTextContent("K7M3Q9");
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("revokes a device only with a reason, then shows it revoked", async () => {
    const list = [TILL, PHONE];
    const calls = fakeApi(list, {
      [`POST /api/v1/access/devices/${TILL.id}/revoke`]: () => {
        const revoked: DeviceView = {
          ...TILL,
          status: "revoked",
          revokedAt: "2026-09-26T08:00:00.000Z",
          revokedBy: { id: "0190a000-0000-7000-8000-00000000c001", name: "سامر" },
          revokeReason: "سُرق",
        };
        list[0] = revoked;
        return Response.json(revoked);
      },
    });
    renderScreen({ initial: { selected: TILL.id } });
    const panel = await screen.findByRole("complementary", { name: "الصندوق الرئيسي" });
    await userEvent.click(within(panel).getByRole("button", { name: "إبطال الجهاز" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: /إبطال الجهاز «الصندوق الرئيسي»/,
    });
    expect(dialog).not.toHaveTextContent("هذا هو الجهاز الذي تعمل عليه الآن");

    await userEvent.click(within(dialog).getByRole("button", { name: "إبطال الجهاز" }));
    expect(within(dialog).getByLabelText("سبب الإبطال")).toHaveAccessibleDescription(
      /اكتب سبب الإبطال/,
    );
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);

    await userEvent.type(within(dialog).getByLabelText("سبب الإبطال"), " سُرق ");
    await userEvent.click(within(dialog).getByRole("button", { name: "إبطال الجهاز" }));
    expect(await within(panel).findByRole("status")).toHaveTextContent(
      "أُبطل الجهاز «الصندوق الرئيسي»",
    );
    expect(calls.filter((call) => call.method === "POST")).toEqual([
      {
        method: "POST",
        url: `/api/v1/access/devices/${TILL.id}/revoke`,
        body: { reason: "سُرق" },
      },
    ]);
    // The list is read again: the device now shows revoked, waiting to wipe.
    expect(await within(panel).findByText(/ينتظر أن يتصل الجهاز/)).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "إبطال الجهاز" })).toBeNull();
  });

  it("warns when the device to revoke is this one", async () => {
    fakeApi([TILL]);
    renderScreen({ initial: { selected: TILL.id }, currentDeviceId: TILL.id });
    const panel = await screen.findByRole("complementary", { name: "الصندوق الرئيسي" });
    await userEvent.click(within(panel).getByRole("button", { name: "إبطال الجهاز" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "هذا هو الجهاز الذي تعمل عليه الآن",
    );
  });

  it("says so when the role does not allow managing devices", async () => {
    fakeApi([], {
      "GET /api/v1/access/devices": () =>
        Response.json(
          { type: "about:blank", title: "no", status: 403, code: "access.permission.denied" },
          { status: 403 },
        ),
    });
    renderScreen({ permissions: [] });
    expect(await screen.findByRole("alert")).toHaveTextContent("لا يسمح لك دورك بإدارة الأجهزة.");
    // Nothing the role cannot do is offered: no new device, by button or by N.
    expect(screen.queryByRole("button", { name: /جهاز جديد/ })).toBeNull();
    await userEvent.keyboard("n");
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});

describe("DeviceRemovedScreen", () => {
  it("says the device was removed, and goes on with its one action", async () => {
    const onContinue = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <DeviceRemovedScreen onContinue={onContinue} />
      </I18nextProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "أُزيل هذا الجهاز من المتجر",
    );
    expect(screen.getByRole("button", { name: "متابعة" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onContinue).toHaveBeenCalledOnce();
  });
});
