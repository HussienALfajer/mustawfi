// @vitest-environment jsdom
import { CalendarDate } from "@internationalized/date";
import { createI18n } from "@mustawfi/i18n";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ReactNode, useState } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COPY_FEEDBACK_MS, CopyButton } from "./copy-button.tsx";
import { DatePicker, DateRangePicker, type DateRangeValue, presetRange } from "./date-picker.tsx";
import { LocaleProvider } from "./locale-provider.tsx";
import { UI_NAMESPACE, uiMessages } from "./messages.ts";
import { PasswordField } from "./password-field.tsx";
import { TOAST_DURATION_MS, ToastProvider, useToast } from "./toast.tsx";

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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DatePicker", () => {
  function Picker({ initial }: { readonly initial: string | null }) {
    const [value, setValue] = useState(initial);
    return (
      <>
        <DatePicker label="تاريخ الفاتورة" value={value} onChange={setValue} />
        <output data-testid="value">{value ?? "none"}</output>
      </>
    );
  }

  it("shows the date as dd/mm/yyyy, left to right, with Western digits", () => {
    wrap(<Picker initial="2026-09-07" />);
    const group = screen.getByRole("group", { name: "تاريخ الفاتورة" });
    const segments = within(group).getAllByRole("spinbutton");
    expect(segments.map((segment) => segment.textContent)).toEqual(["07", "09", "2026"]);
    expect(group.querySelector("[dir=ltr]")).not.toBeNull();
  });

  it("opens a calendar and picks a day with the keyboard", async () => {
    wrap(<Picker initial="2026-09-07" />);
    await userEvent.click(
      screen.getByRole("button", { name: new RegExp(uiMessages.datePicker.open) }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("grid")).toBeInTheDocument();
    await userEvent.keyboard("{ArrowLeft}{Enter}");
    expect(screen.getByTestId("value")).toHaveTextContent("2026-09-08");
  });

  it("offers «اليوم» on the store's calendar", async () => {
    wrap(<Picker initial={null} />);
    await userEvent.click(
      screen.getByRole("button", { name: new RegExp(uiMessages.datePicker.open) }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: uiMessages.datePicker.preset.today }),
    );
    expect(screen.getByTestId("value")).toHaveTextContent(presetRange("today").start.toString());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("DateRangePicker", () => {
  function Range() {
    const [value, setValue] = useState<DateRangeValue | null>(null);
    return (
      <>
        <DateRangePicker label="الفترة" value={value} onChange={setValue} />
        <output data-testid="value">
          {value === null ? "none" : `${value.start}/${value.end}`}
        </output>
      </>
    );
  }

  it("sets both ends from a preset and closes", async () => {
    wrap(<Range />);
    await userEvent.click(
      screen.getByRole("button", { name: new RegExp(uiMessages.datePicker.open) }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: uiMessages.datePicker.preset.last7 }),
    );
    const { start, end } = presetRange("last7");
    expect(screen.getByTestId("value")).toHaveTextContent(`${start.toString()}/${end.toString()}`);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names its presets by the calendar, both ends included", () => {
    const now = new CalendarDate(2026, 3, 15);
    const range = (preset: Parameters<typeof presetRange>[0]) => {
      const { start, end } = presetRange(preset, now);
      return `${start.toString()}..${end.toString()}`;
    };
    expect(range("today")).toBe("2026-03-15..2026-03-15");
    expect(range("yesterday")).toBe("2026-03-14..2026-03-14");
    expect(range("last7")).toBe("2026-03-09..2026-03-15");
    expect(range("last30")).toBe("2026-02-14..2026-03-15");
    expect(range("thisMonth")).toBe("2026-03-01..2026-03-15");
    expect(range("lastMonth")).toBe("2026-02-01..2026-02-28");
    const newYear = (preset: Parameters<typeof presetRange>[0]) => {
      const { start, end } = presetRange(preset, new CalendarDate(2027, 1, 3));
      return `${start.toString()}..${end.toString()}`;
    };
    expect(newYear("last7")).toBe("2026-12-28..2027-01-03");
    expect(newYear("lastMonth")).toBe("2026-12-01..2026-12-31");
  });

  it("counts today on the store's calendar, not the device's time zone", () => {
    // 23:30 UTC on 31 December is already 1 January in Damascus (UTC+3).
    vi.useFakeTimers({ now: new Date("2026-12-31T23:30:00Z") });
    expect(presetRange("today").start.toString()).toBe("2027-01-01");
  });
});

describe("PasswordField", () => {
  it("hides the secret until the toggle shows it, and hides it again", async () => {
    wrap(<PasswordField label="الرمز السري" inputMode="numeric" defaultValue="4827" />);
    const field = screen.getByLabelText("الرمز السري");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAttribute("inputmode", "numeric");
    expect(field).toHaveAttribute("dir", "ltr");
    const toggle = screen.getByRole("button", { name: uiMessages.passwordField.reveal });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);
    expect(field).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(toggle);
    expect(field).toHaveAttribute("type", "password");
  });

  it("hides again when a form empties it after a save", async () => {
    function Resettable() {
      const [value, setValue] = useState("");
      return (
        <>
          <PasswordField label="الرمز الجديد" value={value} onChange={setValue} />
          <button
            type="button"
            onClick={() => {
              setValue("");
            }}
          >
            reset
          </button>
        </>
      );
    }
    wrap(<Resettable />);
    await userEvent.type(screen.getByLabelText("الرمز الجديد"), "2580");
    await userEvent.click(screen.getByRole("button", { name: uiMessages.passwordField.reveal }));
    expect(screen.getByLabelText("الرمز الجديد")).toHaveAttribute("type", "text");
    await userEvent.click(screen.getByRole("button", { name: "reset" }));
    expect(screen.getByLabelText("الرمز الجديد")).toHaveAttribute("type", "password");
  });

  it("reports an error as text and marks the field invalid", () => {
    wrap(<PasswordField label="كلمة المرور" errorMessage="هذا الحقل مطلوب" value="" />);
    expect(screen.getByLabelText("كلمة المرور")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("هذا الحقل مطلوب")).toBeInTheDocument();
  });
});

describe("CopyButton", () => {
  // The visible «نسخ» and the hidden name of what is copied.
  const COPY_NAME = /نسخ\s+رمز التسجيل/;

  it("copies the value and says so, then reads «نسخ» again", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    wrap(<CopyButton value="K7Q4-MX29" label="رمز التسجيل" />);
    const button = screen.getByRole("button", { name: COPY_NAME });
    await user.click(button);
    expect(writeText).toHaveBeenCalledWith("K7Q4-MX29");
    expect(await screen.findByRole("status")).toHaveTextContent("نُسخ رمز التسجيل");
    expect(button).toHaveTextContent(uiMessages.copy.done);
    act(() => {
      vi.advanceTimersByTime(COPY_FEEDBACK_MS);
    });
    expect(button).toHaveTextContent(uiMessages.copy.action);
  });

  it("says when the clipboard refuses, so the value is copied by hand", async () => {
    const writeText = vi.fn(() => Promise.reject(new Error("denied")));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    wrap(<CopyButton value="K7Q4-MX29" label="رمز التسجيل" />);
    await userEvent.click(screen.getByRole("button", { name: COPY_NAME }));
    expect(await screen.findByRole("status")).toHaveTextContent(uiMessages.copy.failed);
  });
});

describe("Toast", () => {
  function Saver() {
    const toast = useToast();
    return (
      <>
        <button
          type="button"
          onClick={() => {
            toast.show("حُفظ القسم");
          }}
        >
          save
        </button>
        <button
          type="button"
          onClick={() => {
            toast.show("لا رمز سري بعد", { tone: "warning" });
          }}
        >
          warn
        </button>
      </>
    );
  }

  it("shows a success in a polite live region and closes it by itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    wrap(
      <ToastProvider>
        <Saver />
      </ToastProvider>,
    );
    const region = screen.getByRole("region", { name: uiMessages.toast.region });
    expect(region.querySelector("[aria-live=polite]")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "save" }));
    expect(within(region).getByText("حُفظ القسم")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS.success);
    });
    expect(within(region).queryByText("حُفظ القسم")).toBeNull();
  });

  it("stays while the pointer is on it, and its close button closes it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    wrap(
      <ToastProvider>
        <Saver />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "warn" }));
    const message = screen.getByText("لا رمز سري بعد");
    await user.hover(message);
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS.warning * 2);
    });
    expect(screen.getByText("لا رمز سري بعد")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: uiMessages.toast.close }));
    expect(screen.queryByText("لا رمز سري بعد")).toBeNull();
  });

  it("stays while its close button has the focus, even when the pointer leaves", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    wrap(
      <ToastProvider>
        <Saver />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "save" }));
    const close = screen.getByRole("button", { name: uiMessages.toast.close });
    act(() => {
      close.focus();
    });
    await user.hover(close);
    await user.unhover(close);
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS.success * 2);
    });
    expect(screen.getByText("حُفظ القسم")).toBeInTheDocument();
  });

  it("has no error tone: failures stay on the screen (design-system.md, pattern 6)", () => {
    const tones = Object.keys(TOAST_DURATION_MS).sort();
    expect(tones).toEqual(["info", "success", "warning"]);
  });

  it("needs a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => wrap(<Saver />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});

describe("focus ring", () => {
  // Tailwind v4's `outline-none` sets the outline style to `none` and `outline-2` keeps it, so a
  // ring without `outline-solid` under the same variant never shows (found in slice 19).
  it("pairs every outline width with a solid style under the same variant", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const sources = readdirSync(dir)
      .filter((name) => /\.tsx?$/.test(name) && !name.includes(".test."))
      .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
    const missing: string[] = [];
    for (const { name, text } of sources) {
      for (const match of text.matchAll(/([\w\-[\]=:()]*:)?outline-2\b/g)) {
        const variant = match[1] ?? "";
        if (!text.includes(`${variant}outline-solid`)) missing.push(`${name}: ${match[0]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
