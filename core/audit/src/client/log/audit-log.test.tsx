// @vitest-environment jsdom
import { createI18n } from "@mustawfi/i18n";
import { presetRange, UI_NAMESPACE, uiMessages } from "@mustawfi/ui";
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
  type AuditWords,
  formatAuditValue,
} from "./audit-log-screen.tsx";

// The writing modules' labels (rule 34) live in their own namespaces; two stand in for them.
const i18n = createI18n({
  [UI_NAMESPACE]: uiMessages,
  [AUDIT_NAMESPACE]: auditMessages,
  organization: {
    audit: {
      department: { renamed: "تغيير اسم قسم" },
      profile: { changed: "تعديل بيانات المتجر" },
    },
    auditEntity: { department: "قسم", storeProfile: "بيانات المتجر" },
    auditField: { name: "الاسم", logo: "الشعار", logoPrint: "طباعة الشعار", phones: "الهواتف" },
    auditValue: { logoPrint: { threshold: "شعار خطّي", dither: "صورة" } },
  },
  access: {
    audit: {
      pin: { failed: "رمز PIN خاطئ على الجهاز" },
      session: {
        revoked: "إنهاء جلسة",
        revokedFor: { switchedUser: "إنهاء جلسة: تبديل المستخدم على الجهاز" },
      },
    },
  },
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

/**
 * A fake API: the facets, the log's pages by their `after` (the first page by `first`), and
 * single entries by id (404 for others).
 */
function fakeApi(pages: Record<string, AuditPage>, single: readonly AuditEntryView[] = []) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    urls.push(url);
    if (url.startsWith("/api/v1/audit/facets")) return Promise.resolve(Response.json(FACETS));
    const one = /^\/api\/v1\/audit\/entries\/([^/?]+)$/.exec(url)?.[1];
    if (one !== undefined) {
      const found = single.find((item) => item.id === one);
      return Promise.resolve(
        found === undefined
          ? Response.json(
              { type: "about:blank", title: "none", status: 404, code: "audit.entry.notFound" },
              { status: 404 },
            )
          : Response.json(found),
      );
    }
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

  it("show snapshot values in words, not codes or JSON (QA slice 26)", () => {
    const words: AuditWords = {
      field: (field) => ({ users: "المستخدمون" })[field],
      coded: (field, value) => (field === "logoPrint" && value === "dither" ? "صورة" : undefined),
      yes: "نعم",
      no: "لا",
      image: (type, kilobytes) => `صورة ${type} (${kilobytes} ك.ب)`,
      list: (items) => items.join("، "),
      named: (name, code) => `${name} (${code})`,
      pair: (field, value) => `${field}: ${value}`,
    };
    expect(formatAuditValue("الملحقات", "name", words)).toBe("الملحقات");
    expect(formatAuditValue("dither", "logoPrint", words)).toBe("صورة");
    expect(formatAuditValue(2, "failures", words)).toBe("2");
    expect(formatAuditValue(true, "hasPin", words)).toBe("نعم");
    expect(formatAuditValue(null, "address", words)).toBeUndefined();
    expect(formatAuditValue(undefined, "address", words)).toBeUndefined();
    expect(formatAuditValue([], "phones", words)).toBeUndefined();
    expect(formatAuditValue(["+963944123456", "+963933000111"], "phones", words)).toBe(
      "+963944123456، +963933000111",
    );
    expect(formatAuditValue("2026-09-26T08:00:00.000Z", "expiresAt", words)).toBe(
      formatAuditInstant("2026-09-26T08:00:00.000Z"),
    );
    expect(formatAuditValue("2026-09-26", "businessDate", words)).toBe("26/09/2026");
    expect(
      formatAuditValue({ size: 227686, type: "image/png", sha256: "4812" }, "logo", words),
    ).toBe("صورة PNG (222 ك.ب)");
    expect(formatAuditValue({ amount: "50", currency: "SYP" }, "total", words)).toBe("50 SYP");
    expect(formatAuditValue([{ code: "1100", name: "الصندوق" }], "accounts", words)).toBe(
      "الصندوق (1100)",
    );
    expect(formatAuditValue({ users: 6, other: 2 }, "limits", words)).toBe(
      "المستخدمون: 6، other: 2",
    );
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

  it("labels each reason an entry records separately, and falls back to the action's label", async () => {
    const session = { type: "access.session", id: "0190a000-0000-7000-8000-00000000f0f1" };
    fakeApi({
      first: {
        items: [
          entry("0190a000-0000-7000-8000-00000000e011", {
            action: "access.session.revoked",
            entity: session,
            before: null,
            after: { userId: OWNER.id, reason: "switchedUser" },
          }),
          entry("0190a000-0000-7000-8000-00000000e012", {
            action: "access.session.revoked",
            entity: session,
            before: null,
            after: { userId: OWNER.id, reason: "somethingNew" },
          }),
        ],
        next: null,
      },
    });
    renderScreen();
    const table = await screen.findByRole("grid", { name: "سجل التدقيق" });
    expect(
      within(table).getByRole("row", { name: /إنهاء جلسة: تبديل المستخدم على الجهاز/ }),
    ).toBeInTheDocument();
    // A reason this client has no label for reads as the action itself.
    expect(within(table).getAllByRole("row", { name: /إنهاء جلسة/ })).toHaveLength(2);
    expect(within(table).getAllByRole("row", { name: /إنهاء جلسة:/ })).toHaveLength(1);
  });

  it("shows one record's history when opened from a panel's last line, and clears it", async () => {
    const urls = fakeApi({ first: { items: [RENAMED], next: null } });
    const entity = RENAMED.entity?.id ?? "";
    renderScreen({ entity, selected: RENAMED.id });
    // Its latest entry is open beside it.
    expect(await screen.findByRole("complementary", { name: "تغيير اسم قسم" })).toBeVisible();
    expect(screen.getByTestId("audit-entity-filter")).toHaveTextContent("يعرض سجل عنصر واحد");
    const asked = urls.find((url) => url.startsWith("/api/v1/audit/entries"));
    expect(new URL(asked ?? "", "http://localhost").searchParams.get("entity")).toBe(entity);
    await userEvent.click(screen.getByRole("button", { name: "مسح التصفية" }));
    expect(screen.getByTestId("filters")).toHaveTextContent("{}");
    expect(screen.queryByTestId("audit-entity-filter")).toBeNull();
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

  it("filters by a range of dates picked from a preset, both ends in the URL", async () => {
    fakeApi({ first: { items: [RENAMED], next: null } });
    renderScreen();
    await screen.findByRole("grid", { name: "سجل التدقيق" });
    await userEvent.click(screen.getByRole("button", { name: /فتح التقويم/ }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "آخر 7 أيام" }));
    const { start, end } = presetRange("last7");
    expect(screen.getByTestId("filters")).toHaveTextContent(
      `"from":"${start.toString()}","to":"${end.toString()}"`,
    );
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
    const name = within(values).getByRole("row", { name: /الاسم/ });
    expect(name).toHaveTextContent("الإكسسوارات");
    expect(name).toHaveTextContent("الملحقات");
    expect(name).toHaveAttribute("data-changed", "true");
    // The record in words, its id kept for tracing.
    expect(panel).toHaveTextContent(`السجل المعنيقسم «الملحقات»${RENAMED.entity?.id ?? ""}`);
  });

  it("names fields and coded values, and folds away the fields that did not change (QA slice 26)", async () => {
    const changed = entry("0190a000-0000-7000-8000-00000000e021", {
      action: "organization.profile.changed",
      entity: { type: "organization.storeProfile", id: "0190a000-0000-7000-8000-0000000b0001" },
      before: { name: "متجر النور", logoPrint: "threshold", logo: null, phones: [] },
      after: {
        name: "متجر النور",
        logoPrint: "dither",
        logo: { size: 20480, type: "image/png", sha256: "ab" },
        phones: [],
      },
    });
    fakeApi({ first: { items: [changed], next: null } });
    renderScreen({ selected: changed.id });
    const panel = await screen.findByRole("complementary", { name: "تعديل بيانات المتجر" });
    const values = within(panel).getByRole("table", { name: "القيم قبل التغيير وبعده" });
    expect(
      within(values)
        .getAllByRole("row")
        .map((row) => row.textContent),
    ).toEqual(["الحقلقبلبعد", "طباعة الشعارشعار خطّيصورة", "الشعار—صورة PNG (20 ك.ب)"]);
    expect(panel).not.toHaveTextContent("logoPrint");
    // The unchanged ones wait behind their summary.
    const folded = within(panel).getByText("حقلان لم يتغيرا");
    expect(folded.closest("details")).not.toHaveAttribute("open");
    expect(
      within(panel).getByRole("table", { name: "الحقول التي لم تتغير", hidden: true }),
    ).toHaveTextContent("الاسممتجر النورمتجر النور");
  });

  it("says when the entry a link names is not in the store's log (QA slice 26)", async () => {
    fakeApi({ first: { items: [RENAMED], next: null } });
    renderScreen({ selected: "0190a000-0000-7000-8000-00000000eeee" });
    expect(
      await screen.findByText("لا يوجد في سجل هذا المتجر إدخال بهذا الرابط."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "إخفاء" }));
    expect(screen.getByTestId("filters")).toHaveTextContent("{}");
  });

  it("reopens from the URL an entry beyond the loaded pages, asking for it alone (QA slice 25)", async () => {
    const urls = fakeApi(
      {
        first: { items: [RENAMED], next: RENAMED.id },
        [RENAMED.id]: { items: [PIN_FAILED], next: null },
      },
      [RENAMED, PIN_FAILED],
    );
    renderScreen({ selected: PIN_FAILED.id });
    const panel = await screen.findByRole("complementary", { name: "رمز PIN خاطئ على الجهاز" });
    expect(panel).toHaveTextContent("ليلى");
    expect(urls).toContain(`/api/v1/audit/entries/${PIN_FAILED.id}`);
    // Not the second page: the entry alone.
    expect(urls.some((url) => url.includes(`after=${RENAMED.id}`))).toBe(false);
  });

  it("asks for no entry alone when a loaded page holds it, nor for an id that is none", async () => {
    const urls = fakeApi({ first: { items: [RENAMED], next: RENAMED.id } }, [RENAMED]);
    renderScreen({ selected: RENAMED.id });
    await screen.findByRole("complementary", { name: "تغيير اسم قسم" });
    cleanup();
    renderScreen({ selected: "not-an-id" });
    await screen.findByRole("grid", { name: "سجل التدقيق" });
    expect(urls.filter((url) => /\/entries\/[^?]/.test(url))).toEqual([]);
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
