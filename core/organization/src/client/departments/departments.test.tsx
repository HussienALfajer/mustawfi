// @vitest-environment jsdom
import { AUDIT_NAMESPACE, auditMessages } from "@mustawfi/core-audit/client";
import { createI18n } from "@mustawfi/i18n";
import { ToastProvider, UI_NAMESPACE, uiMessages } from "@mustawfi/ui";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DepartmentView } from "../../shared/index.ts";
import { ORGANIZATION_NAMESPACE, organizationMessages } from "../messages.ts";
import {
  type DepartmentFilters,
  departmentFiltersSchema,
  DepartmentsScreen,
  filterDepartments,
} from "./departments-screen.tsx";

const i18n = createI18n({
  [UI_NAMESPACE]: uiMessages,
  [ORGANIZATION_NAMESPACE]: organizationMessages,
  [AUDIT_NAMESPACE]: auditMessages,
});

const STORE: DepartmentView = {
  id: "0190a000-0000-7000-8000-000000000001",
  name: "المتجر",
  isDefault: true,
  sortOrder: 0,
  archivedAt: null,
};
const REPAIRS: DepartmentView = {
  id: "0190a000-0000-7000-8000-000000000002",
  name: "الصيانة",
  isDefault: false,
  sortOrder: 1,
  archivedAt: null,
};
const OLD: DepartmentView = {
  id: "0190a000-0000-7000-8000-000000000003",
  name: "الإكسسوارات",
  isDefault: false,
  sortOrder: 2,
  archivedAt: "2026-09-20T10:00:00.000Z",
};

describe("department filters", () => {
  it("default to the active departments with no search, and survive a bad URL", () => {
    expect(departmentFiltersSchema.parse({})).toEqual({ status: "active", q: "" });
    expect(departmentFiltersSchema.parse({ status: "gone", q: 7 })).toEqual({
      status: "active",
      q: "",
    });
  });

  it("filter by status and by name", () => {
    const all = [STORE, REPAIRS, OLD];
    expect(filterDepartments(all, { status: "active", q: "" })).toEqual([STORE, REPAIRS]);
    expect(filterDepartments(all, { status: "archived", q: "" })).toEqual([OLD]);
    expect(filterDepartments(all, { status: "all", q: " صيان " })).toEqual([REPAIRS]);
  });
});

/** A fake API: the departments list, and each write answered from `answers`. */
function fakeApi(departments: DepartmentView[], answers: Record<string, () => Response> = {}) {
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
    return Promise.resolve(
      Response.json({ items: departments.map((item) => ({ lastChange: null, ...item })) }),
    );
  });
  return calls;
}

function problem(status: number, code: string) {
  return () => Response.json({ type: "about:blank", title: "refused", status, code }, { status });
}

function Screen({ initial = {} }: { readonly initial?: Partial<DepartmentFilters> }) {
  const [filters, setFilters] = useState<DepartmentFilters>({
    status: "active",
    q: "",
    ...initial,
  });
  return (
    <>
      <DepartmentsScreen filters={filters} onFiltersChange={setFilters} />
      <output data-testid="filters">{JSON.stringify(filters)}</output>
    </>
  );
}

function renderScreen(initial?: Partial<DepartmentFilters>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <div dir="rtl">
            <Screen {...(initial === undefined ? {} : { initial })} />
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

describe("DepartmentsScreen", () => {
  it("lists the active departments with the default one marked, and opens one beside the list", async () => {
    fakeApi([STORE, REPAIRS, OLD]);
    renderScreen();
    const table = await screen.findByRole("grid", { name: "الأقسام" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByRole("row", { name: /المتجر/ })).toHaveTextContent("الافتراضي");
    expect(within(table).queryByText("الإكسسوارات")).toBeNull();
    await userEvent.click(within(table).getByText("الصيانة"));
    const panel = screen.getByRole("complementary", { name: "الصيانة" });
    expect(within(panel).getByLabelText(/اسم القسم/)).toHaveValue("الصيانة");
    expect(screen.getByTestId("filters")).toHaveTextContent(REPAIRS.id);
  });

  it("adds a department from N, and keeps its panel open with the answer", async () => {
    const added: DepartmentView = {
      ...REPAIRS,
      id: "0190a000-0000-7000-8000-000000000009",
      name: "تحويل الرصيد",
    };
    const list = [STORE];
    const calls = fakeApi(list, {
      "POST /api/v1/organization/departments": () => {
        list.push(added);
        return Response.json(added, { status: 201 });
      },
    });
    renderScreen();
    await screen.findByRole("grid", { name: "الأقسام" });
    await userEvent.keyboard("n");
    const field = within(screen.getByRole("complementary", { name: "قسم جديد" })).getByLabelText(
      /اسم القسم/,
    );
    expect(field).toHaveFocus();
    await userEvent.keyboard("تحويل الرصيد{Control>}s{/Control}");
    // The panel moved to the new department.
    expect(await screen.findByRole("complementary", { name: "تحويل الرصيد" })).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: uiMessages.toast.region })).getByRole("list"),
    ).toHaveTextContent("أُضيف القسم «تحويل الرصيد»");
    expect(calls).toContainEqual({
      method: "POST",
      url: "/api/v1/organization/departments",
      body: { name: "تحويل الرصيد" },
    });
    expect(screen.getByTestId("filters")).toHaveTextContent(added.id);
  });

  it("checks the name with the shared schema before sending anything", async () => {
    const calls = fakeApi([STORE]);
    renderScreen({ selected: "new" });
    const panel = await screen.findByRole("complementary", { name: "قسم جديد" });
    await userEvent.click(within(panel).getByRole("button", { name: /إضافة/ }));
    expect(within(panel).getByLabelText(/اسم القسم/)).toHaveAccessibleDescription(/اكتب اسم القسم/);
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
  });

  it("explains a taken name on the field and a reached limit on the panel", async () => {
    fakeApi([STORE, REPAIRS], {
      "POST /api/v1/organization/departments": problem(409, "tenancy.department.nameTaken"),
    });
    renderScreen({ selected: "new" });
    const panel = await screen.findByRole("complementary", { name: "قسم جديد" });
    await userEvent.type(within(panel).getByLabelText(/اسم القسم/), "الصيانة{Enter}");
    await waitFor(() => {
      expect(within(panel).getByLabelText(/اسم القسم/)).toHaveAccessibleDescription(
        /يوجد قسم بهذا الاسم/,
      );
    });

    cleanup();
    fakeApi([STORE, REPAIRS], {
      "POST /api/v1/organization/departments": problem(409, "tenancy.limit.departments"),
    });
    renderScreen({ selected: "new" });
    const again = await screen.findByRole("complementary", { name: "قسم جديد" });
    await userEvent.type(within(again).getByLabelText(/اسم القسم/), "الإكسسوارات{Enter}");
    expect(await within(again).findByRole("alert")).toHaveTextContent(/حد الأقسام في باقتك/);
    // A larger plan comes from Vertex: its WhatsApp number, to copy (M6 decision).
    expect(within(again).getByText("+963 945 739 573")).toHaveAttribute("dir", "ltr");
    expect(within(again).getByRole("button", { name: /رقم واتساب الدعم/ })).toBeInTheDocument();
    expect(within(again).getByLabelText(/اسم القسم/)).toHaveValue("الإكسسوارات");
  });

  it("archives only after one confirmation, and never offers it for the default department", async () => {
    const calls = fakeApi([STORE, REPAIRS], {
      [`POST /api/v1/organization/departments/${REPAIRS.id}/archive`]: () =>
        Response.json({ ...REPAIRS, archivedAt: "2026-09-25T10:00:00.000Z" }),
    });
    renderScreen({ selected: STORE.id });
    const store = await screen.findByRole("complementary", { name: "المتجر" });
    expect(within(store).queryByRole("button", { name: /أرشفة/ })).toBeNull();

    cleanup();
    renderScreen({ selected: REPAIRS.id });
    const panel = await screen.findByRole("complementary", { name: "الصيانة" });
    await userEvent.click(within(panel).getByRole("button", { name: /أرشفة القسم/ }));
    const dialog = screen.getByRole("alertdialog", { name: /أرشفة القسم «الصيانة»/ });
    expect(calls.some((call) => call.url.endsWith("/archive"))).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "أرشفة" }));
    expect(await screen.findByText("أُرشف القسم «الصيانة»")).toBeInTheDocument();
    expect(calls.filter((call) => call.url.endsWith("/archive"))).toHaveLength(1);
  });

  it("offers to restore an archived department whose name is typed, whatever its case or spaces", async () => {
    const list = [STORE, OLD];
    const calls = fakeApi(list, {
      [`POST /api/v1/organization/departments/${OLD.id}/restore`]: () => {
        const restored = { ...OLD, archivedAt: null };
        list[1] = restored;
        return Response.json(restored);
      },
    });
    renderScreen({ selected: "new" });
    const panel = await screen.findByRole("complementary", { name: "قسم جديد" });
    await userEvent.type(within(panel).getByLabelText(/اسم القسم/), "  الإكسسوارات ");
    const offer = within(panel).getByRole("status");
    expect(offer).toHaveTextContent("يوجد قسم مؤرشف باسم «الإكسسوارات»");
    await userEvent.click(within(offer).getByRole("button", { name: "استعادة «الإكسسوارات»" }));
    // Restored, not added: the panel moves to it, with no confirmation asked.
    expect(await screen.findByRole("complementary", { name: "الإكسسوارات" })).toBeVisible();
    expect(calls.filter((call) => call.method === "POST")).toEqual([
      {
        method: "POST",
        url: `/api/v1/organization/departments/${OLD.id}/restore`,
        body: undefined,
      },
    ]);
    expect(screen.getByTestId("filters")).toHaveTextContent(OLD.id);
    expect(
      within(screen.getByRole("region", { name: uiMessages.toast.region })).getByRole("list"),
    ).toHaveTextContent("استُعيد القسم «الإكسسوارات»");
  });

  it("says on the field when the server finds an archived department with the name", async () => {
    fakeApi([STORE], {
      "POST /api/v1/organization/departments": problem(409, "tenancy.department.nameArchived"),
    });
    renderScreen({ selected: "new" });
    const panel = await screen.findByRole("complementary", { name: "قسم جديد" });
    await userEvent.type(within(panel).getByLabelText(/اسم القسم/), "الورشة{Enter}");
    await waitFor(() => {
      expect(within(panel).getByLabelText(/اسم القسم/)).toHaveAccessibleDescription(
        /يوجد قسم مؤرشف بهذا الاسم/,
      );
    });
  });

  it("restores an archived department from its panel, and ends the panel with its last change", async () => {
    const archived = {
      ...OLD,
      lastChange: {
        entryId: "0190a000-0000-7000-8000-0000000ae001",
        at: "2026-09-20T10:00:00.000Z",
        by: { id: "0190a000-0000-7000-8000-00000000c001", name: "سامر" },
        bySupport: false,
      },
    };
    const calls = fakeApi([STORE, archived], {
      [`POST /api/v1/organization/departments/${OLD.id}/restore`]: () =>
        Response.json({ ...OLD, archivedAt: null }),
    });
    renderScreen({ status: "archived", selected: OLD.id });
    const panel = await screen.findByRole("complementary", { name: "الإكسسوارات" });
    expect(panel.querySelector("[data-last-change]")).toHaveTextContent(
      /^آخر تعديل بواسطة سامر في /,
    );
    expect(within(panel).queryByRole("button", { name: /أرشفة/ })).toBeNull();
    await userEvent.click(within(panel).getByRole("button", { name: "استعادة القسم" }));
    expect(
      await within(screen.getByRole("region", { name: uiMessages.toast.region })).findByRole(
        "list",
      ),
    ).toHaveTextContent("استُعيد القسم «الإكسسوارات»");
    expect(calls.filter((call) => call.url.endsWith("/restore"))).toHaveLength(1);
    // The archived filter would hide it now: the list shows all, the panel stays on it.
    expect(JSON.parse(screen.getByTestId("filters").textContent ?? "")).toEqual({
      status: "all",
      q: "",
      selected: OLD.id,
    });
  });

  it("says when the list needs the server and the device is offline", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    renderScreen();
    expect(await screen.findByRole("alert")).toHaveTextContent(/تحتاج اتصالًا بالخادم/);
  });
});
