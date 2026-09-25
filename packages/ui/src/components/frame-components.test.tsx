// @vitest-environment jsdom
import { createI18n } from "@mustawfi/i18n";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Badge } from "./badge.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { DataTable } from "./data-table.tsx";
import { enterMovesToNextField } from "./keyboard.ts";
import { UI_NAMESPACE, uiMessages } from "./messages.ts";
import { SearchField } from "./search-field.tsx";
import { SegmentedControl } from "./segmented-control.tsx";
import { SideNavigation, useNavigationCollapsed } from "./side-navigation.tsx";
import { SidePanel } from "./side-panel.tsx";

const i18n = createI18n({ [UI_NAMESPACE]: uiMessages });

function wrap(node: ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <div dir="rtl">{node}</div>
    </I18nextProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function Navigation({ initiallyCollapsed = false }: { readonly initiallyCollapsed?: boolean }) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  return (
    <SideNavigation
      label="التنقل الرئيسي"
      brand="مستوفي"
      collapsedBrand="م"
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      collapseLabel="طيّ القائمة"
      expandLabel="توسيع القائمة"
      groups={[
        {
          id: "admin",
          label: "الإدارة",
          items: [
            {
              id: "departments",
              label: "الأقسام",
              icon: null,
              link: ({ className, children }) => (
                <a href="/departments" className={className} aria-current="page">
                  {children}
                </a>
              ),
            },
          ],
        },
        { id: "reports", label: "التقارير", items: [] },
      ]}
    />
  );
}

describe("SideNavigation", () => {
  it("shows groups with entries only, and names links by their label when collapsed", () => {
    wrap(<Navigation initiallyCollapsed />);
    expect(screen.getByRole("group", { name: "الإدارة" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "التقارير" })).toBeNull();
    expect(screen.getByRole("link", { name: "الأقسام" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "توسيع القائمة" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("collapses and expands with its button and with Ctrl+B", async () => {
    wrap(<Navigation />);
    const toggle = screen.getByRole("button", { name: /طيّ القائمة/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(toggle);
    expect(screen.getByRole("navigation")).toHaveAttribute("data-collapsed", "true");
    await userEvent.keyboard("{Control>}b{/Control}");
    expect(screen.getByRole("navigation")).not.toHaveAttribute("data-collapsed");
    // With the Arabic layout the same key types «لا»: shortcuts follow the physical key.
    fireEvent.keyDown(document.body, { key: "لا", code: "KeyB", ctrlKey: true });
    expect(screen.getByRole("navigation")).toHaveAttribute("data-collapsed", "true");
  });

  it("remembers the collapsed state on the device, and still works when storage refuses", () => {
    const first = renderHook(() => useNavigationCollapsed("nav"));
    act(() => {
      first.result.current[1](true);
    });
    expect(renderHook(() => useNavigationCollapsed("nav")).result.current[0]).toBe(true);

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const refused = renderHook(() => useNavigationCollapsed("nav"));
    expect(refused.result.current[0]).toBe(false);
    act(() => {
      refused.result.current[1](true);
    });
    expect(refused.result.current[0]).toBe(true);
  });
});

describe("SidePanel", () => {
  it("is a region named by its title, and Esc inside it closes it", async () => {
    const onClose = vi.fn();
    wrap(
      <SidePanel title="الصيانة" closeLabel="إغلاق" onClose={onClose} footer={<button>حفظ</button>}>
        <input aria-label="الاسم" />
      </SidePanel>,
    );
    expect(screen.getByRole("complementary", { name: "الصيانة" })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("الاسم"));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "إغلاق" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("SearchField", () => {
  it("takes focus on / unless the user is typing in another field", async () => {
    function Screen() {
      const [value, setValue] = useState("");
      return (
        <>
          <input aria-label="حقل آخر" />
          <SearchField label="ابحث" value={value} onChange={setValue} />
        </>
      );
    }
    wrap(<Screen />);
    const search = screen.getByRole("searchbox", { name: "ابحث" });
    await userEvent.click(screen.getByLabelText("حقل آخر"));
    await userEvent.keyboard("/");
    expect(screen.getByLabelText("حقل آخر")).toHaveValue("/");
    await userEvent.click(document.body);
    await userEvent.keyboard("/");
    expect(search).toHaveFocus();
    await userEvent.keyboard("صيانة");
    expect(search).toHaveValue("صيانة");
  });
});

describe("SegmentedControl", () => {
  it("picks one option and never none", async () => {
    const onChange = vi.fn();
    wrap(
      <SegmentedControl
        label="الحالة"
        value="active"
        onChange={onChange}
        options={[
          { id: "active", label: "النشطة" },
          { id: "archived", label: "المؤرشفة" },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "المؤرشفة" }));
    expect(onChange).toHaveBeenLastCalledWith("archived");
    await userEvent.click(screen.getByRole("radio", { name: "النشطة" }));
    for (const [value] of onChange.mock.calls) expect(["active", "archived"]).toContain(value);
  });
});

describe("DataTable selection", () => {
  it("moves the selection with the arrow keys and clears it with Esc", async () => {
    function Table() {
      const [selected, setSelected] = useState<string | null>(null);
      return (
        <>
          <DataTable
            label="الأقسام"
            rows={[
              { id: "a", name: "المتجر" },
              { id: "b", name: "الصيانة" },
            ]}
            rowId={(row) => row.id}
            columns={[{ id: "name", header: "الاسم", cell: (row) => row.name }]}
            selectedId={selected}
            onSelect={setSelected}
          />
          <output>{selected ?? "none"}</output>
        </>
      );
    }
    wrap(<Table />);
    await userEvent.click(screen.getByText("المتجر"));
    expect(screen.getByRole("status")).toHaveTextContent("a");
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("status")).toHaveTextContent("b");
    expect(screen.getByRole("row", { name: /الصيانة/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("status")).toHaveTextContent("none");
  });
});

describe("ConfirmDialog", () => {
  it("starts on Cancel so a stray Enter destroys nothing, and confirms on its button", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    wrap(
      <ConfirmDialog
        isOpen
        onOpenChange={onOpenChange}
        title="أرشفة القسم؟"
        confirmLabel="أرشفة"
        cancelLabel="إلغاء"
        onConfirm={onConfirm}
      >
        لن يظهر في البيع بعد الآن
      </ConfirmDialog>,
    );
    expect(screen.getByRole("alertdialog", { name: "أرشفة القسم؟" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إلغاء" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "أرشفة" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe("enterMovesToNextField", () => {
  it("moves Enter to the next field, and submits from the last one with Save outside the form", async () => {
    const onSubmit = vi.fn((event: Event) => {
      event.preventDefault();
    });
    wrap(
      <form
        onKeyDown={enterMovesToNextField}
        onSubmit={(event) => {
          onSubmit(event.nativeEvent);
        }}
      >
        <input aria-label="الأول" />
        <textarea aria-label="العنوان" />
        <input aria-label="الأخير" />
      </form>,
    );
    await userEvent.click(screen.getByLabelText("الأول"));
    await userEvent.keyboard("{Enter}");
    expect(screen.getByLabelText("العنوان")).toHaveFocus();
    await userEvent.click(screen.getByLabelText("الأخير"));
    await userEvent.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

describe("Badge", () => {
  it("writes the status as a word", () => {
    wrap(<Badge tone="positive">نشط</Badge>);
    expect(screen.getByText("نشط")).toHaveClass("text-text-positive");
  });
});
