// @vitest-environment jsdom
import { createI18n } from "@mustawfi/i18n";
import { UI_NAMESPACE, uiMessages } from "@mustawfi/ui";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleView } from "../../shared/index.ts";
import { ACCESS_NAMESPACE, accessMessages } from "../messages.ts";
import { type CurrentSession, sessionQueryKey } from "../session.ts";
import type { PermissionCatalogueView } from "./queries.ts";
import { matrixGroups } from "./role-form.tsx";
import { filterRoles, type RoleFilters, roleFiltersSchema, RolesScreen } from "./roles-screen.tsx";

/** A fixture module's labels, as a module's client entry ships them. */
const salesFixture = {
  moduleName: "المبيعات",
  permission: { invoice: { create: "البيع وإنشاء الفواتير" }, invoices: { view: "عرض الفواتير" } },
  limit: { discount: { maxPercent: "أعلى نسبة خصم" } },
};

const i18n = createI18n({
  [UI_NAMESPACE]: uiMessages,
  [ACCESS_NAMESPACE]: accessMessages,
  sales: salesFixture,
});

const CATALOGUE: PermissionCatalogueView = {
  permissions: [
    { id: "access.users.view", moduleId: "core.access", scoped: false },
    { id: "access.users.manage", moduleId: "core.access", scoped: false },
    { id: "sales.invoices.view", moduleId: "sales", scoped: false },
    { id: "sales.invoice.create", moduleId: "sales", scoped: true },
  ],
  limits: [{ id: "sales.discount.maxPercent", moduleId: "sales", kind: "percent" }],
};
const EVERYTHING = CATALOGUE.permissions.map((permission) => permission.id);

function role(id: string, name: string, extra: Partial<RoleView> = {}): RoleView {
  return {
    id,
    name,
    template: null,
    isOwner: false,
    archivedAt: null,
    permissions: [],
    limits: {},
    activeUsers: 0,
    ...extra,
  };
}

const OWNER = role("0190a000-0000-7000-8000-00000000b001", "المالك", {
  template: "owner",
  isOwner: true,
  permissions: EVERYTHING,
  activeUsers: 1,
});
const CASHIER = role("0190a000-0000-7000-8000-00000000b002", "كاشير القسم", {
  template: "sectionCashier",
  permissions: ["sales.invoice.create"],
  limits: { "sales.discount.maxPercent": "5" },
  activeUsers: 2,
});
const OLD = role("0190a000-0000-7000-8000-00000000b003", "مؤقت", {
  archivedAt: "2026-09-20T10:00:00.000Z",
});

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
      role: { id: OWNER.id, name: OWNER.name, isOwner: true },
      departmentScope: "all",
      departments: [],
      permissions,
    },
  };
}

describe("role filters and matrix", () => {
  it("default to the active roles, and survive a bad URL", () => {
    expect(roleFiltersSchema.parse({})).toEqual({ status: "active", q: "" });
    expect(roleFiltersSchema.parse({ status: "gone", from: 3 })).toEqual({
      status: "active",
      q: "",
    });
    expect(filterRoles([OWNER, CASHIER, OLD], { status: "archived", q: "" })).toEqual([OLD]);
    expect(filterRoles([OWNER, CASHIER, OLD], { status: "all", q: " كاشير " })).toEqual([CASHIER]);
  });

  it("group the catalogue by declaring module, limits under their module", () => {
    expect(
      matrixGroups(CATALOGUE).map((group) => ({
        moduleId: group.moduleId,
        permissions: group.permissions.map((permission) => permission.id),
        limits: group.limits.map((limit) => limit.id),
      })),
    ).toEqual([
      {
        moduleId: "core.access",
        permissions: ["access.users.view", "access.users.manage"],
        limits: [],
      },
      {
        moduleId: "sales",
        permissions: ["sales.invoices.view", "sales.invoice.create"],
        limits: ["sales.discount.maxPercent"],
      },
    ]);
  });
});

function fakeApi(roles: RoleView[], answers: Record<string, () => Response> = {}) {
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
    if (url.endsWith("/catalogue")) return Promise.resolve(Response.json(CATALOGUE));
    return Promise.resolve(Response.json({ items: roles }));
  });
  return calls;
}

function problem(status: number, code: string) {
  return () => Response.json({ type: "about:blank", title: "refused", status, code }, { status });
}

function Screen({ initial }: { readonly initial: Partial<RoleFilters> }) {
  const [filters, setFilters] = useState<RoleFilters>({ status: "active", q: "", ...initial });
  return (
    <>
      <RolesScreen filters={filters} onFiltersChange={setFilters} />
      <output data-testid="filters">{JSON.stringify(filters)}</output>
    </>
  );
}

function renderScreen(
  initial: Partial<RoleFilters> = {},
  permissions = ["access.users.view", "access.roles.manage"],
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(sessionQueryKey, session(permissions));
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

describe("RolesScreen", () => {
  it("lists roles with their kind and users, and shows the matrix grouped by module", async () => {
    fakeApi([OWNER, CASHIER, OLD]);
    renderScreen();
    const table = await screen.findByRole("grid", { name: "الأدوار" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByRole("row", { name: /كاشير القسم/ })).toHaveTextContent("قالب");
    await userEvent.click(within(table).getByText("كاشير القسم"));
    const panel = screen.getByRole("complementary", { name: "كاشير القسم" });
    const sales = within(panel).getByRole("group", { name: "المبيعات" });
    expect(within(sales).getByRole("checkbox", { name: /البيع وإنشاء الفواتير/ })).toBeChecked();
    expect(
      within(sales).getByRole("checkbox", { name: /البيع وإنشاء الفواتير/ }),
    ).toHaveAccessibleDescription(/ضمن أقسام المستخدم/);
    expect(within(sales).getByRole("checkbox", { name: "عرض الفواتير" })).not.toBeChecked();
    expect(within(sales).getByLabelText("أعلى نسبة خصم")).toHaveValue("5");
    expect(within(panel).getByRole("group", { name: "المستخدمون والأجهزة" })).toBeInTheDocument();
  });

  it("saves a role's permissions and limits, checking the limit value first", async () => {
    const calls = fakeApi([OWNER, CASHIER], {
      [`PUT /api/v1/access/roles/${CASHIER.id}`]: () =>
        Response.json({ ...CASHIER, permissions: ["sales.invoice.create", "sales.invoices.view"] }),
    });
    renderScreen({ selected: CASHIER.id });
    const panel = await screen.findByRole("complementary", { name: "كاشير القسم" });
    await userEvent.click(within(panel).getByRole("checkbox", { name: "عرض الفواتير" }));
    const limit = within(panel).getByLabelText("أعلى نسبة خصم");
    await userEvent.clear(limit);
    await userEvent.type(limit, "-3");
    await userEvent.keyboard("{Control>}s{/Control}");
    expect(limit).toHaveAccessibleDescription(/رقمًا موجبًا/);
    expect(calls.filter((call) => call.method === "PUT")).toEqual([]);
    await userEvent.clear(limit);
    await userEvent.type(limit, "7.5");
    await userEvent.keyboard("{Control>}s{/Control}");
    await waitFor(() => {
      expect(within(panel).getByRole("status")).toHaveTextContent("حُفظ الدور «كاشير القسم»");
    });
    expect(calls).toContainEqual({
      method: "PUT",
      url: `/api/v1/access/roles/${CASHIER.id}`,
      body: {
        name: "كاشير القسم",
        permissions: ["sales.invoice.create", "sales.invoices.view"],
        limits: { "sales.discount.maxPercent": "7.5" },
      },
    });
  });

  it("copies a role into a new one", async () => {
    const copy = role("0190a000-0000-7000-8000-00000000b009", "كاشير القسم (نسخة)", {
      permissions: CASHIER.permissions,
      limits: CASHIER.limits,
    });
    const list = [OWNER, CASHIER];
    const calls = fakeApi(list, {
      "POST /api/v1/access/roles": () => {
        list.push(copy);
        return Response.json(copy, { status: 201 });
      },
    });
    renderScreen({ selected: CASHIER.id });
    const panel = await screen.findByRole("complementary", { name: "كاشير القسم" });
    await userEvent.click(within(panel).getByRole("button", { name: "نسخ الدور" }));
    const draft = await screen.findByRole("complementary", { name: "نسخة من «كاشير القسم»" });
    expect(within(draft).getByLabelText(/اسم الدور/)).toHaveValue("كاشير القسم (نسخة)");
    await userEvent.click(within(draft).getByRole("button", { name: /إنشاء/ }));
    const saved = await screen.findByRole("complementary", { name: "كاشير القسم (نسخة)" });
    expect(within(saved).getByRole("status")).toHaveTextContent("أُنشئ الدور");
    expect(calls).toContainEqual({
      method: "POST",
      url: "/api/v1/access/roles",
      body: {
        name: "كاشير القسم (نسخة)",
        permissions: ["sales.invoice.create"],
        limits: { "sales.discount.maxPercent": "5" },
      },
    });
  });

  it("shows the owner role read-only with everything, and offers only a copy", async () => {
    fakeApi([OWNER, CASHIER]);
    renderScreen({ selected: OWNER.id });
    const panel = await screen.findByRole("complementary", { name: "المالك" });
    for (const box of within(panel).getAllByRole("checkbox")) expect(box).toBeChecked();
    expect(within(panel).getByRole("checkbox", { name: "عرض الفواتير" })).toHaveAttribute(
      "aria-readonly",
      "true",
    );
    expect(within(panel).queryByRole("button", { name: /حفظ|أرشفة/ })).toBeNull();
    expect(within(panel).getByRole("button", { name: "نسخ الدور" })).toBeInTheDocument();
  });

  it("archives after one confirmation, and says why when active users hold the role", async () => {
    fakeApi([OWNER, CASHIER], {
      [`POST /api/v1/access/roles/${CASHIER.id}/archive`]: problem(409, "access.role.inUse"),
    });
    renderScreen({ selected: CASHIER.id });
    const panel = await screen.findByRole("complementary", { name: "كاشير القسم" });
    await userEvent.click(within(panel).getByRole("button", { name: /أرشفة الدور/ }));
    const dialog = screen.getByRole("alertdialog", { name: /أرشفة الدور «كاشير القسم»/ });
    await userEvent.click(within(dialog).getByRole("button", { name: "أرشفة" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent(/يحمل هذا الدور مستخدمون/);
  });

  it("shows roles read-only to a role that may only view them", async () => {
    fakeApi([OWNER, CASHIER]);
    renderScreen({ selected: CASHIER.id }, ["access.users.view"]);
    const panel = await screen.findByRole("complementary", { name: "كاشير القسم" });
    expect(screen.queryByRole("button", { name: /دور جديد/ })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /حفظ|نسخ|أرشفة/ })).toBeNull();
    expect(panel).toHaveTextContent("يسمح لك دورك بعرض الأدوار دون تعديلها");
  });
});
