// @vitest-environment jsdom
import { createI18n } from "@mustawfi/i18n";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Checkbox, CheckboxGroup } from "./checkbox.tsx";
import { LocaleProvider } from "./locale-provider.tsx";
import { UI_NAMESPACE, uiMessages } from "./messages.ts";
import { Select } from "./select.tsx";

const i18n = createI18n({ [UI_NAMESPACE]: uiMessages });

function wrap(node: ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <LocaleProvider>
        <div dir="rtl">{node}</div>
      </LocaleProvider>
    </I18nextProvider>,
  );
}

afterEach(cleanup);

const ROLES = [
  { id: "cashier", label: "كاشير القسم" },
  { id: "accountant", label: "المحاسب" },
] as const;

describe("Select", () => {
  it("is labelled, shows the chosen option, and chooses with the keyboard", async () => {
    const onChange = vi.fn();
    wrap(<Select label="الدور" options={ROLES} value="cashier" onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: /الدور/ });
    expect(trigger).toHaveTextContent("كاشير القسم");
    await userEvent.tab();
    expect(trigger).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    const listbox = await screen.findByRole("listbox");
    expect(listbox).toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("accountant");
  });

  it("shows the placeholder with nothing chosen and reports an error as text", () => {
    wrap(
      <Select
        label="الدور"
        placeholder="اختر"
        errorMessage="اختر دورًا"
        options={ROLES}
        value={null}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: /الدور/ })).toHaveTextContent("اختر");
    expect(screen.getByText("اختر دورًا")).toBeInTheDocument();
  });
});

describe("Checkbox", () => {
  it("toggles with Space and carries its description", async () => {
    const onChange = vi.fn();
    wrap(
      <Checkbox isSelected={false} onChange={onChange} description="ضمن أقسام المستخدم">
        إنشاء فواتير البيع
      </Checkbox>,
    );
    const box = screen.getByRole("checkbox", { name: /إنشاء فواتير البيع/ });
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription("ضمن أقسام المستخدم");
    await userEvent.tab();
    expect(box).toHaveFocus();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does not change when read-only", async () => {
    const onChange = vi.fn();
    wrap(
      <Checkbox isSelected onChange={onChange} isReadOnly>
        عرض المنتجات
      </Checkbox>,
    );
    const box = screen.getByRole("checkbox", { name: "عرض المنتجات" });
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("CheckboxGroup", () => {
  function Scope({ onChange }: { readonly onChange: (value: string[]) => void }) {
    const [value, setValue] = useState<string[]>(["store"]);
    return (
      <CheckboxGroup
        label="الأقسام"
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        errorMessage={value.length === 0 ? "اختر قسمًا واحدًا على الأقل" : undefined}
      >
        <Checkbox value="store">المتجر</Checkbox>
        <Checkbox value="repairs">الصيانة</Checkbox>
      </CheckboxGroup>
    );
  }

  it("names its group and keeps the list of checked values", async () => {
    const onChange = vi.fn();
    wrap(<Scope onChange={onChange} />);
    expect(screen.getByRole("group", { name: "الأقسام" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "الصيانة" }));
    expect(onChange).toHaveBeenLastCalledWith(["store", "repairs"]);
    await userEvent.click(screen.getByRole("checkbox", { name: "المتجر" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "الصيانة" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByText("اختر قسمًا واحدًا على الأقل")).toBeInTheDocument();
  });
});
