// @vitest-environment jsdom
import { AUDIT_NAMESPACE, auditMessages } from "@mustawfi/core-audit/client";
import { createI18n } from "@mustawfi/i18n";
import { ToastProvider, UI_NAMESPACE, uiMessages } from "@mustawfi/ui";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceList, DeviceListItem, DeviceView } from "../../shared/index.ts";
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

const i18n = createI18n({
  [UI_NAMESPACE]: uiMessages,
  [ACCESS_NAMESPACE]: accessMessages,
  [AUDIT_NAMESPACE]: auditMessages,
});

const OWNER = { id: "0190a000-0000-7000-8000-00000000c001", name: "سامر" };

function device(id: string, name: string, extra: Partial<DeviceListItem> = {}): DeviceListItem {
  return {
    id,
    name,
    type: "mainPos",
    platform: "windows",
    prefix: "K7",
    registeredAt: "2026-09-20T08:00:00.000Z",
    lastSyncAt: "2026-09-26T07:30:00.000Z",
    status: "active",
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    wipedAt: null,
    lastChange: {
      entryId: "0190a000-0000-7000-8000-0000000ae001",
      at: "2026-09-20T08:00:00.000Z",
      by: OWNER,
      bySupport: false,
    },
    ...extra,
  };
}

const LIMITS: DeviceList["limits"] = {
  mainPos: { used: 1, allowed: 3 },
  companion: { used: 1, allowed: 2 },
};

const TILL = device("0190a000-0000-7000-8000-0000000de001", "الصندوق الرئيسي");
const PHONE = device("0190a000-0000-7000-8000-0000000de002", "هاتف المستودع", {
  type: "companion",
  platform: "browser",
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
function fakeApi(devices: DeviceListItem[], answers: Record<string, () => Response> = {}) {
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
    return Promise.resolve(Response.json({ items: devices, limits: LIMITS }));
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
    license: {
      state: "active",
      expiresAt: "2027-09-25T08:00:00.000Z",
      readOnlyAt: "2027-10-02T08:00:00.000Z",
      suspendedAt: "2027-11-01T08:00:00.000Z",
    },
    user: {
      id: "0190a000-0000-7000-8000-00000000c001",
      name: "سامر",
      login: "owner",
      role: { id: "0190a000-0000-7000-8000-00000000b001", name: "المالك", isOwner: false },
      departmentScope: "all",
      departments: [],
      permissions,
      limits: {},
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
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <div dir="rtl">
            <Screen initial={initial} currentDeviceId={currentDeviceId} />
          </div>
        </QueryClientProvider>
      </ToastProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(cleanup);

describe("DevicesScreen", () => {
  it("lists each device's type with its platform, prefix, last sync, and status, marking this one", async () => {
    fakeApi([TILL, PHONE, OLD]);
    renderScreen({ initial: { status: "all" }, currentDeviceId: PHONE.id });
    const table = await screen.findByRole("grid", { name: "الأجهزة" });
    const till = within(table).getByRole("row", { name: /الصندوق الرئيسي/ });
    expect(till).toHaveTextContent("تطبيق Windows — جهاز بيع رئيسي");
    expect(within(table).getByRole("row", { name: /هاتف المستودع/ })).toHaveTextContent(
      "متصفح — جهاز مساعد",
    );
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

  it("says in a device's panel which license limit it counts against, and ends with its last change", async () => {
    fakeApi([TILL, PHONE]);
    renderScreen({ initial: { selected: PHONE.id } });
    const panel = await screen.findByRole("complementary", { name: "هاتف المستودع" });
    expect(within(panel).getByTestId("device-kind")).toHaveTextContent(
      "متصفح — جهاز مساعديُحسب ضمن الأجهزة المساعدة: 1 من 2",
    );
    // No audit link given (the viewer may not read the log): the line is plain text.
    const last = panel.querySelector("[data-last-change]");
    expect(last).toHaveTextContent(/^آخر تعديل بواسطة سامر في /);
    expect(within(panel).queryByRole("link")).toBeNull();
  });

  it("links the last change to the record's history for readers of the audit log", async () => {
    fakeApi([TILL]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(sessionQueryKey, session(["access.devices.manage"]));
    render(
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <QueryClientProvider client={queryClient}>
            <DevicesScreen
              filters={{ status: "active", q: "", selected: TILL.id }}
              onFiltersChange={() => undefined}
              currentDeviceId={null}
              auditLink={(target, children) => (
                <a href={`/admin/audit?entity=${target.entity}&selected=${target.entry}`}>
                  {children}
                </a>
              )}
            />
          </QueryClientProvider>
        </ToastProvider>
      </I18nextProvider>,
    );
    const panel = await screen.findByRole("complementary", { name: "الصندوق الرئيسي" });
    expect(within(panel).getByRole("link", { name: /آخر تعديل بواسطة سامر/ })).toHaveAttribute(
      "href",
      `/admin/audit?entity=${TILL.id}&selected=${TILL.lastChange?.entryId ?? ""}`,
    );
  });

  it("renames an active device with Enter; its prefix stays", async () => {
    const list = [TILL];
    const calls = fakeApi(list, {
      [`PATCH /api/v1/access/devices/${TILL.id}`]: () => {
        const renamed: DeviceView = { ...TILL, name: "صندوق المدخل" };
        list[0] = { ...TILL, name: "صندوق المدخل" };
        return Response.json(renamed);
      },
    });
    renderScreen({ initial: { selected: TILL.id } });
    const panel = await screen.findByRole("complementary", { name: "الصندوق الرئيسي" });
    const name = within(panel).getByLabelText("اسم الجهاز");
    expect(name).toHaveAccessibleDescription(/K7/);
    await userEvent.clear(name);
    await userEvent.keyboard("{Enter}");
    expect(name).toHaveAccessibleDescription(/اكتب اسم الجهاز/);
    expect(calls.filter((call) => call.method === "PATCH")).toEqual([]);
    await userEvent.type(name, "صندوق المدخل{Enter}");
    expect(
      await within(screen.getByRole("region", { name: uiMessages.toast.region })).findByRole(
        "list",
      ),
    ).toHaveTextContent("صار اسم الجهاز «صندوق المدخل»");
    expect(calls.filter((call) => call.method === "PATCH")).toEqual([
      {
        method: "PATCH",
        url: `/api/v1/access/devices/${TILL.id}`,
        body: { name: "صندوق المدخل" },
      },
    ]);
  });

  it("shows a revoked device's revoke: when, by whom, why, and its wipe", async () => {
    fakeApi([OLD]);
    renderScreen({ initial: { status: "revoked", selected: OLD.id } });
    const panel = await screen.findByRole("complementary", { name: "الصندوق القديم" });
    expect(panel).toHaveTextContent("سامر");
    expect(panel).toHaveTextContent("تعطّل");
    expect(panel).toHaveTextContent(`مُسحت في ${formatInstant(OLD.wipedAt ?? "")}`);
    expect(within(panel).queryByRole("button", { name: "إبطال الجهاز" })).toBeNull();
    // A revoked device keeps the name it was revoked under.
    expect(within(panel).queryByLabelText("اسم الجهاز")).toBeNull();
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
    // What each kind of device registers as, and the limit it counts against.
    expect(within(panel).getByTestId("device-kinds")).toHaveTextContent(
      "تطبيق Windows — جهاز بيع رئيسييُحسب ضمن أجهزة البيع الرئيسية: 1 من 3" +
        "متصفح — جهاز مساعديُحسب ضمن الأجهزة المساعدة: 1 من 2",
    );
    const issue = within(panel).getByRole("button", { name: "إصدار رمز تسجيل" });
    expect(issue).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(await within(panel).findByTestId("registration-code")).toHaveTextContent("ABCDE-FGHJK");
    expect(within(panel).getByTestId("store-code")).toHaveTextContent("K7M3Q9");
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    // Both codes are carried to the new device: each has its own copy button.
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await userEvent.click(within(panel).getByRole("button", { name: /نسخ\s+رمز التسجيل/ }));
    expect(writeText).toHaveBeenLastCalledWith("ABCDE-FGHJK");
    await userEvent.click(within(panel).getByRole("button", { name: /نسخ\s+رمز المتجر/ }));
    expect(writeText).toHaveBeenLastCalledWith("K7M3Q9");
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
        list[0] = { ...revoked, lastChange: TILL.lastChange };
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
    expect(
      await within(screen.getByRole("region", { name: uiMessages.toast.region })).findByRole(
        "list",
      ),
    ).toHaveTextContent("أُبطل الجهاز «الصندوق الرئيسي»");
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
        <ToastProvider>
          <DeviceRemovedScreen onContinue={onContinue} />
        </ToastProvider>
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
