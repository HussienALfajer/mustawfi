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
import type { RoleView, UserView } from "../../shared/index.ts";
import { ACCESS_NAMESPACE, accessMessages } from "../messages.ts";
import { type CurrentSession, sessionQueryKey } from "../session.ts";
import type { DepartmentOption } from "./user-form.tsx";
import { filterUsers, type UserFilters, userFiltersSchema, UsersScreen } from "./users-screen.tsx";

const i18n = createI18n({
  [UI_NAMESPACE]: uiMessages,
  [ACCESS_NAMESPACE]: accessMessages,
  [AUDIT_NAMESPACE]: auditMessages,
});

const STORE: DepartmentOption = {
  id: "0190a000-0000-7000-8000-00000000d001",
  name: "المتجر",
  archivedAt: null,
};
const REPAIRS: DepartmentOption = {
  id: "0190a000-0000-7000-8000-00000000d002",
  name: "الصيانة",
  archivedAt: null,
};

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

const OWNER_ROLE = role("0190a000-0000-7000-8000-00000000b001", "المالك", {
  template: "owner",
  isOwner: true,
});
const CASHIER_ROLE = role("0190a000-0000-7000-8000-00000000b002", "كاشير القسم", {
  template: "sectionCashier",
  permissions: ["sales.invoice.create"],
});
const ACCOUNTANT_ROLE = role("0190a000-0000-7000-8000-00000000b003", "المحاسب", {
  template: "accountant",
});

function user(id: string, name: string, extra: Partial<UserView> = {}): UserView {
  return {
    id,
    name,
    login: null,
    role: { id: CASHIER_ROLE.id, name: CASHIER_ROLE.name, isOwner: false },
    departmentScope: "all",
    departments: [],
    status: "active",
    hasPassword: false,
    hasPin: true,
    twoFactorEnabled: false,
    createdAt: "2026-09-26T08:00:00.000Z",
    ...extra,
  };
}

const SAMER = user("0190a000-0000-7000-8000-00000000c001", "سامر", {
  login: "owner",
  role: { id: OWNER_ROLE.id, name: OWNER_ROLE.name, isOwner: true },
  hasPassword: true,
});
const RANA = user("0190a000-0000-7000-8000-00000000c002", "رنا", {
  departmentScope: "listed",
  departments: [REPAIRS.id],
});
const OMAR = user("0190a000-0000-7000-8000-00000000c003", "عمر", {
  login: "omar",
  role: { id: ACCOUNTANT_ROLE.id, name: ACCOUNTANT_ROLE.name, isOwner: false },
});
const OLD = user("0190a000-0000-7000-8000-00000000c004", "خالد", { status: "deactivated" });

function session(permissions: string[], isOwner = true): CurrentSession {
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
      id: SAMER.id,
      name: SAMER.name,
      login: "owner",
      role: { id: OWNER_ROLE.id, name: OWNER_ROLE.name, isOwner },
      departmentScope: "all",
      departments: [],
      permissions,
      limits: {},
    },
  };
}

const MANAGER = ["access.users.view", "access.users.manage", "access.roles.manage"];

describe("user filters", () => {
  it("default to the active users with no search, and survive a bad URL", () => {
    expect(userFiltersSchema.parse({})).toEqual({ status: "active", q: "" });
    expect(userFiltersSchema.parse({ status: "gone", q: 7, role: 3 })).toEqual({
      status: "active",
      q: "",
    });
  });

  it("filter by status, role, department (every-department users included), and name or login", () => {
    const all = [SAMER, RANA, OMAR, OLD];
    expect(filterUsers(all, { status: "active", q: "" })).toEqual([SAMER, RANA, OMAR]);
    expect(filterUsers(all, { status: "deactivated", q: "" })).toEqual([OLD]);
    expect(filterUsers(all, { status: "all", q: "", role: CASHIER_ROLE.id })).toEqual([RANA, OLD]);
    expect(filterUsers(all, { status: "active", q: "", department: STORE.id })).toEqual([
      SAMER,
      OMAR,
    ]);
    expect(filterUsers(all, { status: "active", q: "", department: REPAIRS.id })).toEqual([
      SAMER,
      RANA,
      OMAR,
    ]);
    expect(filterUsers(all, { status: "all", q: " OMA " })).toEqual([OMAR]);
  });
});

/**
 * A fake API: the users and roles lists — the users with the user limit, `allowed` of the
 * license — and each write answered from `answers`.
 */
function fakeApi(users: UserView[], answers: Record<string, () => Response> = {}, allowed = 6) {
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
    if (url.endsWith("/roles")) {
      return Promise.resolve(
        Response.json({
          items: [OWNER_ROLE, CASHIER_ROLE, ACCOUNTANT_ROLE].map((item) => ({
            lastChange: null,
            ...item,
          })),
        }),
      );
    }
    return Promise.resolve(
      Response.json({
        items: users.map((item) => ({ lastChange: null, ...item })),
        limit: { used: users.filter((item) => item.status === "active").length, allowed },
      }),
    );
  });
  return calls;
}

function problem(status: number, code: string) {
  return () => Response.json({ type: "about:blank", title: "refused", status, code }, { status });
}

function Screen({
  initial,
  departments,
}: {
  readonly initial: Partial<UserFilters>;
  readonly departments: readonly DepartmentOption[];
}) {
  const [filters, setFilters] = useState<UserFilters>({ status: "active", q: "", ...initial });
  return (
    <>
      <UsersScreen filters={filters} onFiltersChange={setFilters} departments={departments} />
      <output data-testid="filters">{JSON.stringify(filters)}</output>
    </>
  );
}

function renderScreen({
  initial = {},
  departments = [STORE, REPAIRS],
  permissions = MANAGER,
  isOwner = true,
}: {
  initial?: Partial<UserFilters>;
  departments?: readonly DepartmentOption[];
  permissions?: string[];
  isOwner?: boolean;
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(sessionQueryKey, session(permissions, isOwner));
  return render(
    <I18nextProvider i18n={i18n}>
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <div dir="rtl">
            <Screen initial={initial} departments={departments} />
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

describe("UsersScreen", () => {
  it("lists the active users with their role and departments, and opens one beside the list", async () => {
    fakeApi([SAMER, RANA, OMAR, OLD]);
    renderScreen();
    const table = await screen.findByRole("grid", { name: "المستخدمون" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByRole("row", { name: /رنا/ })).toHaveTextContent("الصيانة");
    expect(within(table).getByRole("row", { name: /سامر/ })).toHaveTextContent("كل الأقسام");
    expect(within(table).queryByText("خالد")).toBeNull();
    await userEvent.click(within(table).getByText("عمر"));
    const panel = screen.getByRole("complementary", { name: "عمر" });
    expect(within(panel).getByLabelText(/اسم الدخول/)).toHaveValue("omar");
    expect(screen.getByTestId("filters")).toHaveTextContent(OMAR.id);
  });

  it("hides every department column, filter, and picker while one department is active", async () => {
    fakeApi([SAMER, RANA]);
    renderScreen({ departments: [STORE, { ...REPAIRS, archivedAt: "2026-09-20T00:00:00Z" }] });
    const table = await screen.findByRole("grid", { name: "المستخدمون" });
    expect(within(table).queryByRole("columnheader", { name: "الأقسام" })).toBeNull();
    expect(screen.queryByRole("button", { name: /القسم/ })).toBeNull();
    await userEvent.keyboard("n");
    const panel = await screen.findByRole("complementary", { name: "مستخدم جديد" });
    expect(within(panel).queryByText("نطاق الأقسام")).toBeNull();
  });

  it("adds a section cashier scoped to one department, checked before anything is sent", async () => {
    const added = user("0190a000-0000-7000-8000-00000000c009", "ليلى", {
      departmentScope: "listed",
      departments: [REPAIRS.id],
    });
    const list = [SAMER];
    const calls = fakeApi(list, {
      "POST /api/v1/access/users": () => {
        list.push(added);
        return Response.json(added, { status: 201 });
      },
    });
    renderScreen();
    await screen.findByRole("grid", { name: "المستخدمون" });
    await userEvent.keyboard("n");
    const panel = await screen.findByRole("complementary", { name: "مستخدم جديد" });
    expect(within(panel).getByLabelText(/^الاسم/)).toHaveFocus();

    // Nothing is sent while the form is incomplete; each problem is said on its field.
    await userEvent.keyboard("ليلى{Control>}s{/Control}");
    expect(within(panel).getByRole("button", { name: /الدور/ })).toHaveAccessibleDescription(
      /اختر دورًا/,
    );
    expect(within(panel).getByLabelText(/الرمز السري الأول/)).toHaveAccessibleDescription(
      /الرمز السري 4 إلى 6 أرقام/,
    );
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);

    await userEvent.click(within(panel).getByRole("button", { name: /الدور/ }));
    await userEvent.click(await screen.findByRole("option", { name: "كاشير القسم" }));
    await userEvent.click(within(panel).getByRole("radio", { name: "أقسام محددة" }));
    await userEvent.keyboard("{Control>}s{/Control}");
    expect(within(panel).getByRole("group", { name: /أقسامه/ })).toHaveTextContent(
      /اختر قسمًا واحدًا على الأقل/,
    );
    await userEvent.click(within(panel).getByRole("checkbox", { name: "الصيانة" }));
    await userEvent.type(within(panel).getByLabelText(/الرمز السري الأول/), "1234");
    await userEvent.keyboard("{Control>}s{/Control}");
    expect(within(panel).getByLabelText(/الرمز السري الأول/)).toHaveAccessibleDescription(
      /تسلسلًا/,
    );
    await userEvent.clear(within(panel).getByLabelText(/الرمز السري الأول/));
    await userEvent.type(within(panel).getByLabelText(/الرمز السري الأول/), "2580");
    await userEvent.keyboard("{Control>}s{/Control}");

    const saved = await screen.findByRole("complementary", { name: "ليلى" });
    expect(
      within(screen.getByRole("region", { name: uiMessages.toast.region })).getByRole("list"),
    ).toHaveTextContent("أُضيف المستخدم «ليلى»");
    // The first PIN field leaves with the new user; focus stays in the panel.
    expect(within(saved).getByLabelText(/^الاسم/)).toHaveFocus();
    expect(calls).toContainEqual({
      method: "POST",
      url: "/api/v1/access/users",
      body: {
        name: "ليلى",
        login: null,
        password: null,
        roleId: CASHIER_ROLE.id,
        departmentScope: "listed",
        departments: [REPAIRS.id],
        pin: "2580",
      },
    });
    expect(screen.getByTestId("filters")).toHaveTextContent(added.id);
  });

  it("explains a reached user limit on the panel, and keeps what was typed", async () => {
    fakeApi([SAMER], { "POST /api/v1/access/users": problem(409, "tenancy.limit.users") });
    renderScreen({ initial: { selected: "new" }, departments: [STORE] });
    const panel = await screen.findByRole("complementary", { name: "مستخدم جديد" });
    await userEvent.type(within(panel).getByLabelText(/^الاسم/), "ليلى");
    await userEvent.click(within(panel).getByRole("button", { name: /الدور/ }));
    await userEvent.click(await screen.findByRole("option", { name: "المحاسب" }));
    await userEvent.type(within(panel).getByLabelText(/الرمز السري الأول/), "2580");
    await userEvent.click(within(panel).getByRole("button", { name: /إضافة/ }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent(/حد المستخدمين في باقتك/);
    expect(within(panel).getByText("+963 945 739 573")).toBeInTheDocument();
    expect(within(panel).getByLabelText(/^الاسم/)).toHaveValue("ليلى");
    // The New button stays: the limit is explained on the action, not hidden.
    expect(screen.getByRole("button", { name: /مستخدم جديد/ })).toBeInTheDocument();
  });

  it("says the store is read-only when the license stops a deactivation", async () => {
    fakeApi([SAMER, OMAR], {
      [`POST /api/v1/access/users/${OMAR.id}/deactivate`]: problem(403, "tenancy.license.readOnly"),
    });
    renderScreen({ initial: { selected: OMAR.id } });
    const panel = await screen.findByRole("complementary", { name: "عمر" });
    await userEvent.click(within(panel).getByRole("button", { name: /إيقاف المستخدم/ }));
    const dialog = screen.getByRole("alertdialog", { name: /إيقاف «عمر»/ });
    await userEvent.type(within(dialog).getByLabelText(/سبب الإيقاف/), "ترك العمل");
    await userEvent.click(within(dialog).getByRole("button", { name: "إيقاف" }));
    expect(
      await screen.findByText(/المتجر للقراءة فقط لأن الترخيص لم يُجدَّد/),
    ).toBeInTheDocument();
  });

  it("deactivates only with a reason, which goes to the server", async () => {
    const list = [SAMER, OMAR];
    const calls = fakeApi(list, {
      [`POST /api/v1/access/users/${OMAR.id}/deactivate`]: () => {
        list[1] = { ...OMAR, status: "deactivated" };
        return Response.json(list[1]);
      },
    });
    renderScreen({ initial: { selected: OMAR.id } });
    const panel = await screen.findByRole("complementary", { name: "عمر" });
    await userEvent.click(within(panel).getByRole("button", { name: /إيقاف المستخدم/ }));
    const dialog = screen.getByRole("alertdialog", { name: /إيقاف «عمر»/ });
    await userEvent.click(within(dialog).getByRole("button", { name: "إيقاف" }));
    expect(within(dialog).getByLabelText(/سبب الإيقاف/)).toHaveAccessibleDescription(
      /اكتب سبب الإيقاف/,
    );
    expect(calls.some((call) => call.url.endsWith("/deactivate"))).toBe(false);
    await userEvent.type(within(dialog).getByLabelText(/سبب الإيقاف/), "ترك العمل");
    await userEvent.click(within(dialog).getByRole("button", { name: "إيقاف" }));
    expect(await screen.findByText("أُوقف «عمر»")).toBeInTheDocument();
    // The button that opened the dialog is gone; focus stays in the panel, so Esc still closes it.
    await waitFor(() => {
      expect(panel.contains(document.activeElement)).toBe(true);
    });
    expect(calls).toContainEqual({
      method: "POST",
      url: `/api/v1/access/users/${OMAR.id}/deactivate`,
      body: { reason: "ترك العمل" },
    });
  });

  it("lets an owner clear someone's two-factor authentication with a reason, and no one else", async () => {
    const list = [SAMER, { ...OMAR, twoFactorEnabled: true }];
    const calls = fakeApi(list, {
      [`POST /api/v1/access/users/${OMAR.id}/two-factor/clear`]: () => {
        list[1] = { ...OMAR, twoFactorEnabled: false };
        return Response.json(list[1]);
      },
    });
    renderScreen({ initial: { selected: OMAR.id } });
    const panel = await screen.findByRole("complementary", { name: "عمر" });
    expect(within(panel).getByText("التحقق بخطوتين مفعّل")).toBeVisible();
    await userEvent.click(within(panel).getByRole("button", { name: /إلغاء التحقق بخطوتين/ }));
    const dialog = screen.getByRole("alertdialog", { name: /إلغاء التحقق بخطوتين لـ«عمر»/ });
    await userEvent.click(within(dialog).getByRole("button", { name: "إلغاء التحقق بخطوتين" }));
    expect(calls.some((call) => call.url.endsWith("/two-factor/clear"))).toBe(false);
    await userEvent.type(within(dialog).getByLabelText(/السبب/), "فقد هاتفه");
    await userEvent.click(within(dialog).getByRole("button", { name: "إلغاء التحقق بخطوتين" }));
    expect(await within(panel).findByText("التحقق بخطوتين غير مفعّل")).toBeVisible();
    expect(calls).toContainEqual({
      method: "POST",
      url: `/api/v1/access/users/${OMAR.id}/two-factor/clear`,
      body: { reason: "فقد هاتفه" },
    });
    cleanup();

    fakeApi([SAMER, { ...OMAR, twoFactorEnabled: true }]);
    renderScreen({ initial: { selected: OMAR.id }, isOwner: false });
    const managerPanel = await screen.findByRole("complementary", { name: "عمر" });
    expect(within(managerPanel).getByText("التحقق بخطوتين مفعّل")).toBeVisible();
    expect(within(managerPanel).queryByRole("button", { name: /إلغاء التحقق بخطوتين/ })).toBeNull();
  });

  it("sends only what changed when a user is edited", async () => {
    const calls = fakeApi([SAMER, RANA], {
      [`PATCH /api/v1/access/users/${RANA.id}`]: () =>
        Response.json({ ...RANA, departmentScope: "all", departments: [] }),
    });
    renderScreen({ initial: { selected: RANA.id } });
    const panel = await screen.findByRole("complementary", { name: "رنا" });
    await userEvent.click(within(panel).getByRole("radio", { name: "كل الأقسام" }));
    await userEvent.click(within(panel).getByRole("button", { name: /حفظ/ }));
    await waitFor(() => {
      expect(
        within(screen.getByRole("region", { name: uiMessages.toast.region })).getByRole("list"),
      ).toHaveTextContent("حُفظ المستخدم «رنا»");
    });
    expect(calls).toContainEqual({
      method: "PATCH",
      url: `/api/v1/access/users/${RANA.id}`,
      body: { departmentScope: "all", departments: [] },
    });
  });

  it("shows users read-only to a role that may only view them", async () => {
    fakeApi([SAMER, OMAR]);
    renderScreen({ initial: { selected: OMAR.id }, permissions: ["access.users.view"] });
    const panel = await screen.findByRole("complementary", { name: "عمر" });
    expect(screen.queryByRole("button", { name: /مستخدم جديد/ })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /حفظ/ })).toBeNull();
    expect(within(panel).getByLabelText(/^الاسم/)).toHaveAttribute("readonly");
    expect(panel).toHaveTextContent("يسمح لك دورك بعرض المستخدمين دون تعديلهم");
  });

  it("keeps an owner out of a non-owner's reach, and the owner role out of their choices", async () => {
    fakeApi([SAMER, OMAR]);
    renderScreen({ initial: { selected: SAMER.id }, isOwner: false });
    const owner = await screen.findByRole("complementary", { name: "سامر" });
    expect(within(owner).queryByRole("button", { name: /حفظ|إيقاف/ })).toBeNull();

    cleanup();
    renderScreen({ initial: { selected: "new" }, isOwner: false });
    const panel = await screen.findByRole("complementary", { name: "مستخدم جديد" });
    await userEvent.click(within(panel).getByRole("button", { name: /الدور/ }));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).queryByRole("option", { name: "المالك" })).toBeNull();
    expect(within(listbox).getByRole("option", { name: "المحاسب" })).toBeInTheDocument();
  });

  it("says the user limit as used of allowed, and a reached one before anything is typed (QA slice 26)", async () => {
    fakeApi([SAMER, OMAR, OLD], {}, 2);
    renderScreen({ departments: [STORE] });
    const add = await screen.findByRole("button", { name: /مستخدم جديد/ });
    expect(await screen.findByText("المستخدمون النشطون: 2 من 2 في باقتك")).toBeInTheDocument();
    expect(add).toHaveAccessibleDescription("المستخدمون النشطون: 2 من 2 في باقتك");
    await userEvent.click(add);
    const panel = await screen.findByRole("complementary", { name: "مستخدم جديد" });
    expect(panel).toHaveTextContent(/وصلت إلى حد المستخدمين في باقتك/);
    expect(within(panel).getByText("+963 945 739 573")).toBeInTheDocument();
    // A deactivated user's reactivation counts the same way.
    await userEvent.click(within(panel).getByRole("button", { name: "إغلاق" }));
    await userEvent.click(screen.getByRole("radio", { name: "الموقوفون" }));
    await userEvent.click(await screen.findByText("خالد"));
    expect(await screen.findByRole("complementary", { name: "خالد" })).toHaveTextContent(
      /وصلت إلى حد المستخدمين في باقتك/,
    );
    cleanup();

    // A role that may only view users is told nothing about a reactivation it cannot make.
    fakeApi([SAMER, OMAR, OLD], {}, 2);
    renderScreen({
      initial: { status: "deactivated", selected: OLD.id },
      permissions: ["access.users.view"],
    });
    expect(await screen.findByRole("complementary", { name: "خالد" })).not.toHaveTextContent(
      /حد المستخدمين/,
    );
    cleanup();

    fakeApi([SAMER, OMAR], {}, 6);
    renderScreen({ initial: { selected: "new" }, departments: [STORE] });
    const room = await screen.findByRole("complementary", { name: "مستخدم جديد" });
    expect(await screen.findByText("المستخدمون النشطون: 2 من 6 في باقتك")).toBeInTheDocument();
    expect(room).not.toHaveTextContent(/حد المستخدمين/);
  });

  it("gives a non-owner manager no way to change a user whose role holds more (QA slice 26)", async () => {
    // The manager's role holds no `sales.invoice.create`, which the cashier's role holds.
    fakeApi([SAMER, { ...RANA, twoFactorEnabled: true }, OMAR]);
    renderScreen({ initial: { selected: RANA.id }, isOwner: false });
    const broader = await screen.findByRole("complementary", { name: "رنا" });
    expect(broader).toHaveTextContent(/دور هذا المستخدم فيه صلاحيات ليست لديك، فيديره المالك/);
    expect(within(broader).queryByLabelText(/رمز سري جديد/)).toBeNull();
    expect(within(broader).queryByLabelText(/كلمة مرور جديدة/)).toBeNull();
    for (const field of [/اسم الدخول/, /^الاسم/]) {
      expect(within(broader).getByLabelText(field)).toHaveAttribute("readonly");
    }
    // No save, deactivation, or other action: an owner manages them. Their 2FA state still shows.
    expect(within(broader).queryByRole("button", { name: /حفظ|إيقاف المستخدم/ })).toBeNull();
    expect(within(broader).getByText("التحقق بخطوتين مفعّل")).toBeVisible();
    cleanup();

    // Nor reactivate one.
    fakeApi([SAMER, { ...RANA, status: "deactivated" }, OMAR]);
    renderScreen({ initial: { status: "all", selected: RANA.id }, isOwner: false });
    const off = await screen.findByRole("complementary", { name: "رنا" });
    expect(within(off).queryByRole("button", { name: "إعادة التفعيل" })).toBeNull();
    cleanup();

    fakeApi([SAMER, RANA, OMAR]);
    renderScreen({ initial: { selected: OMAR.id }, isOwner: false });
    const within_ = await screen.findByRole("complementary", { name: "عمر" });
    expect(within(within_).getByLabelText(/رمز سري جديد/)).toBeInTheDocument();
    expect(within(within_).getByLabelText(/اسم الدخول/)).not.toHaveAttribute("readonly");
    await userEvent.click(within(within_).getByRole("button", { name: /الدور/ }));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).queryByRole("option", { name: "كاشير القسم" })).toBeNull();
    expect(within(listbox).getByRole("option", { name: "المحاسب" })).toBeInTheDocument();
  });

  it("names a role that is gone and an owner given departments (QA slice 26)", async () => {
    fakeApi([SAMER], { "POST /api/v1/access/users": problem(404, "access.role.notFound") });
    renderScreen({ initial: { selected: "new" }, departments: [STORE] });
    const panel = await screen.findByRole("complementary", { name: "مستخدم جديد" });
    await userEvent.type(within(panel).getByLabelText(/^الاسم/), "ليلى");
    await userEvent.click(within(panel).getByRole("button", { name: /الدور/ }));
    await userEvent.click(await screen.findByRole("option", { name: "المحاسب" }));
    await userEvent.type(within(panel).getByLabelText(/الرمز السري الأول/), "2580");
    await userEvent.click(within(panel).getByRole("button", { name: /إضافة/ }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "لم يعد هذا الدور موجودًا. حدّث الصفحة واختر دورًا آخر",
    );
  });

  it("says when the list needs the server and the device is offline", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    renderScreen();
    expect(await screen.findByRole("alert")).toHaveTextContent(/تحتاج اتصالًا بالخادم/);
  });
});
