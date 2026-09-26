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
import type { AuditEntryView, AuditFacets, AuditPage } from "../../shared/index.ts";
import { AUDIT_NAMESPACE, auditMessages } from "../messages.ts";
import {
  type AuditLogFilters,
  auditLogFiltersSchema,
  AuditLogScreen,
  formatAuditInstant,
  formatAuditValue,
} from "./audit-log-screen.tsx";

// The writing modules' labels (rule 34) live in their own namespaces; two stand in for them.
const i18n = createI18n({
  [UI_NAMESPACE]: uiMessages,
  [AUDIT_NAMESPACE]: auditMessages,
  organization: { audit: { department: { renamed: "تغيير اسم قسم" } } },
  access: { audit: { pin: { failed: "رمز PIN خاطئ على الجهاز" } } },
});

const OWNER = { id: "0190a000-0000-7000-8000-00000000c001", name: "سامر" };
const CASHIER = { id: "0190a000-0000-7000-8000-00000000c002", name: "ليلى" };
const TILL = { id: "0190a000-0000-7000-8000-0000000de001", name: "الصندوق", prefix: "K7" };

function entry(id: string, extra: Partial<AuditEntryView> = {}): AuditEntryView {
  return {
    id,
    occurredAt: "2026-09-26T08:00:00.000Z",
    recordedAt: "2026-09-26T08:00:00.000Z",
    source: "server",
    user: OWNER,
    device: null,
    action: "organization.department.renamed",
    entity: { type: "organization.department", id: "0190a000-0000-7000-8000-0000000d0001" },
    before: { name: "الإكسسوارات" },
    after: { name: "الملحقات" },
    reason: null,
    ...extra,
  };
}

const RENAMED = entry("0190a000-0000-7000-8000-00000000e001");
const PIN_FAILED = entry("0190a000-0000-7000-8000-00000000e002", {
  occurredAt: "2026-09-25T21:10:00.000Z",
  recordedAt: "2026-09-26T07:00:00.000Z",
  source: "device",
  user: CASHIER,
  device: TILL,
  action: "access.pin.failed",
  entity: null,
  before: null,
  after: { failures: 2 },
});
const UNKNOWN = entry("0190a000-0000-7000-8000-00000000e003", {
  action: "repairs.ticket.opened",
  user: null,
  before: null,
  after: null,
});

const FACETS: AuditFacets = {
  users: [OWNER, CASHIER],
  devices: [TILL],
  actions: ["access.pin.failed", "organization.department.renamed"],
};

/** A fake API: the facets, and the log's pages by their `after` (the first page by `first`). */
function fakeApi(pages: Record<string, AuditPage>) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    urls.push(url);
    if (url.startsWith("/api/v1/audit/facets")) return Promise.resolve(Response.json(FACETS));
    const after = new URL(url, "http://localhost").searchParams.get("after") ?? "first";
    return Promise.resolve(Response.json(pages[after] ?? { items: [], next: null }));
  });
  return urls;
}

function Screen({ initial }: { readonly initial: AuditLogFilters }) {
  const [filters, setFilters] = useState<AuditLogFilters>(initial);
  return (
    <>
      <AuditLogScreen filters={filters} onFiltersChange={setFilters} />
      <output data-testid="filters">{JSON.stringify(filters)}</output>
    </>
  );
}

function renderScreen(initial: AuditLogFilters = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <div dir="rtl">
          <Screen initial={initial} />
        </div>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(cleanup);

describe("audit log filters", () => {
  it("drop what the URL gets wrong and keep the rest", () => {
    expect(
      auditLogFiltersSchema.parse({
        user: CASHIER.id,
        action: "Not an action",
        device: "K7",
        from: "2026-09-01",
        to: "yesterday",
        selected: RENAMED.id,
      }),
    ).toEqual({ user: CASHIER.id, from: "2026-09-01", selected: RENAMED.id });
  });

  it("show snapshot values as text: strings as they are, the rest as JSON", () => {
    expect(formatAuditValue("الملحقات")).toBe("الملحقات");
    expect(formatAuditValue(2)).toBe("2");
    expect(formatAuditValue(null)).toBe("null");
    expect(formatAuditValue(["a", "b"])).toBe('["a","b"]');
    expect(formatAuditValue(undefined)).toBeUndefined();
  });
});

describe("AuditLogScreen", () => {
  it("lists entries with Arabic labels, users, devices, and both times", async () => {
    fakeApi({ first: { items: [RENAMED, PIN_FAILED, UNKNOWN], next: null } });
    renderScreen();
    const table = await screen.findByRole("grid", { name: "سجل التدقيق" });
    const renamed = within(table).getByRole("row", { name: /تغيير اسم قسم/ });
    expect(renamed).toHaveTextContent("سامر");
    const pin = within(table).getByRole("row", { name: /رمز PIN خاطئ على الجهاز/ });
    expect(pin).toHaveTextContent("ليلى");
    expect(pin).toHaveTextContent("الصندوق");
    expect(pin).toHaveTextContent("K7");
    expect(pin).toHaveTextContent(formatAuditInstant(PIN_FAILED.occurredAt));
    expect(pin).toHaveTextContent(formatAuditInstant(PIN_FAILED.recordedAt));
    // An action this client has no label for still shows, by its code.
    expect(
      within(table).getByRole("row", { name: /إجراء غير معروف \(repairs\.ticket\.opened\)/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("لا سجلات أقدم")).toBeInTheDocument();
  });

  it("asks the server with the URL's filters", async () => {
    const urls = fakeApi({ first: { items: [PIN_FAILED], next: null } });
    renderScreen({ user: CASHIER.id, device: TILL.id, from: "2026-09-25", to: "2026-09-26" });
    await screen.findByRole("grid", { name: "سجل التدقيق" });
    const asked = urls.find((url) => url.startsWith("/api/v1/audit/entries"));
    expect(new URL(asked ?? "", "http://localhost").searchParams.toString()).toBe(
      `user=${CASHIER.id}&device=${TILL.id}&from=2026-09-25&to=2026-09-26`,
    );
  });

  it("filters by user from the keyboard, keeping it in the URL", async () => {
    fakeApi({ first: { items: [RENAMED, PIN_FAILED], next: null } });
    renderScreen();
    await screen.findByRole("grid", { name: "سجل التدقيق" });
    const user = screen.getByRole("button", { name: /المستخدم/ });
    user.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(await screen.findByRole("option", { name: "ليلى" }));
    expect(screen.getByTestId("filters")).toHaveTextContent(`"user":"${CASHIER.id}"`);
  });

  it("does not ask for a range that ends before it starts, and says why", async () => {
    const urls = fakeApi({});
    renderScreen({ from: "2026-09-26", to: "2026-09-25" });
    expect(await screen.findByText("تاريخ البداية بعد تاريخ النهاية")).toBeInTheDocument();
    expect(urls.some((url) => url.startsWith("/api/v1/audit/entries"))).toBe(false);
  });

  it("loads older entries a page at a time", async () => {
    const urls = fakeApi({
      first: { items: [RENAMED], next: RENAMED.id },
      [RENAMED.id]: { items: [PIN_FAILED], next: null },
    });
    renderScreen();
    const table = await screen.findByRole("grid", { name: "سجل التدقيق" });
    expect(within(table).queryByRole("row", { name: /رمز PIN/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "تحميل المزيد" }));
    expect(await within(table).findByRole("row", { name: /رمز PIN/ })).toBeInTheDocument();
    expect(urls.some((url) => url.includes(`after=${RENAMED.id}`))).toBe(true);
    expect(screen.getByText("لا سجلات أقدم")).toBeInTheDocument();
  });

  it("opens an entry beside the log with before and after values", async () => {
    fakeApi({ first: { items: [RENAMED], next: null } });
    renderScreen({ selected: RENAMED.id });
    const panel = await screen.findByRole("complementary", { name: "تغيير اسم قسم" });
    expect(panel).toHaveTextContent("سامر");
    const values = within(panel).getByRole("table", { name: "القيم قبل التغيير وبعده" });
    const name = within(values).getByRole("row", { name: /name/ });
    expect(name).toHaveTextContent("الإكسسوارات");
    expect(name).toHaveTextContent("الملحقات");
    expect(name).toHaveAttribute("data-changed", "true");
  });

  it("shows a device event's device time and the server's receipt", async () => {
    fakeApi({ first: { items: [PIN_FAILED], next: null } });
    renderScreen({ selected: PIN_FAILED.id });
    const panel = await screen.findByRole("complementary", { name: "رمز PIN خاطئ على الجهاز" });
    expect(panel).toHaveTextContent(
      `وقت الحدث (بساعة الجهاز)${formatAuditInstant(PIN_FAILED.occurredAt)}`,
    );
    expect(panel).toHaveTextContent(`سُجّل على الخادم${formatAuditInstant(PIN_FAILED.recordedAt)}`);
    expect(panel).toHaveTextContent("الجهاز، أُرسل عند المزامنة");
    expect(panel).toHaveTextContent("K7");
  });

  it("offers nothing that changes the log", async () => {
    fakeApi({ first: { items: [RENAMED], next: null } });
    renderScreen({ selected: RENAMED.id });
    const panel = await screen.findByRole("complementary", { name: "تغيير اسم قسم" });
    expect(
      within(panel)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([""]);
  });

  it("says when the role does not allow reading the log", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        Response.json(
          { type: "about:blank", title: "denied", status: 403, code: "access.permission.denied" },
          { status: 403 },
        ),
      ),
    );
    renderScreen();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "لا يسمح لك دورك بقراءة سجل التدقيق.",
    );
  });
});
