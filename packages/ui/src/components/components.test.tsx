// @vitest-environment jsdom
import { createI18n, DigitShapeContext } from "@mustawfi/i18n";
import { Currency, Money as KernelMoney } from "@mustawfi/kernel";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./button.tsx";
import { DataTable } from "./data-table.tsx";
import { UI_NAMESPACE, uiMessages } from "./messages.ts";
import { LocaleProvider } from "./locale-provider.tsx";
import { MoneyInput, readMoneyInput } from "./money-input.tsx";
import { Money } from "./money.tsx";
import { TextInput } from "./text-input.tsx";

const i18n = createI18n({ [UI_NAMESPACE]: uiMessages });
const SYP = Currency.of("SYP", 2);
const USD = Currency.of("USD", 2);

function wrap(node: ReactNode, digits: "latn" | "arab" = "latn") {
  return render(
    <I18nextProvider i18n={i18n}>
      <LocaleProvider>
        <DigitShapeContext value={digits}>
          <div dir="rtl">{node}</div>
        </DigitShapeContext>
      </LocaleProvider>
    </I18nextProvider>,
  );
}

afterEach(cleanup);

describe("Button", () => {
  it("presses from the keyboard and shows focus only for keyboard focus", async () => {
    const onPress = vi.fn();
    wrap(<Button onPress={onPress}>حفظ</Button>);
    const button = screen.getByRole("button", { name: "حفظ" });
    await userEvent.tab();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("data-focus-visible", "true");
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it("takes at least one control height on each side (48 px in touch density)", () => {
    wrap(<Button>حفظ</Button>);
    expect(screen.getByRole("button").className).toMatch(/\bmin-h-control\b.*\bmin-w-control\b/);
  });
});

describe("TextInput", () => {
  it("labels the field and reports an error as text, marking the field invalid", () => {
    wrap(<TextInput label="رمز المتجر" description="ستة أحرف" errorMessage="الرمز غير صحيح" />);
    const input = screen.getByLabelText("رمز المتجر");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/الرمز غير صحيح/);
    expect(input).toHaveAccessibleDescription(/ستة أحرف/);
  });

  it("is valid without an error and keeps machine text left to right", async () => {
    const onChange = vi.fn();
    wrap(<TextInput label="اسم الدخول" dir="ltr" onChange={onChange} />);
    const input = screen.getByLabelText("اسم الدخول");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveAttribute("dir", "ltr");
    await userEvent.type(input, "owner");
    expect(onChange).toHaveBeenLastCalledWith("owner");
  });
});

describe("Money", () => {
  it("shows the exact amount padded to the currency's minor units, with its currency", () => {
    wrap(<Money value={KernelMoney.of("1250.5", SYP)} />);
    const amount = screen.getByText("1,250.50");
    expect(amount.tagName).toBe("BDI");
    expect(amount).toHaveAttribute("dir", "ltr");
    expect(amount.parentElement).toHaveTextContent("1,250.50ل.س");
    expect(amount.parentElement?.className).toContain("tabular-nums");
  });

  it("keeps every digit of amounts a float cannot hold, and unit-price decimals", () => {
    wrap(
      <>
        <Money value={KernelMoney.of("98765432109876543.21", USD)} />
        <Money value={KernelMoney.of("0.125", USD)} />
      </>,
    );
    expect(screen.getByText("98,765,432,109,876,543.21")).toBeInTheDocument();
    expect(screen.getByText("0.125")).toBeInTheDocument();
  });

  it("marks a negative amount with a minus sign and the negative colour", () => {
    wrap(<Money value={KernelMoney.of("-3", SYP)} />);
    const amount = screen.getByText("‎-3.00");
    expect(amount.parentElement?.className).toContain("text-text-negative");
  });

  it("draws Arabic-Indic digits when that is the user's setting", () => {
    wrap(<Money value={KernelMoney.of("1250.5", SYP)} />, "arab");
    expect(screen.getByText("١٬٢٥٠٫٥٠")).toBeInTheDocument();
  });

  it("falls back to the ISO code for a currency without a label", () => {
    wrap(<Money value={KernelMoney.of("1", Currency.of("EUR", 2))} />);
    expect(screen.getByText("EUR")).toBeInTheDocument();
  });
});

describe("readMoneyInput", () => {
  it.each([
    ["12.5", "12.5"],
    ["١٬٢٥٠٫٥٠", "1250.50"],
    ["0", "0"],
  ])("reads %j as exact money", (text, amount) => {
    const result = readMoneyInput(text, SYP);
    expect(result.money?.equals(KernelMoney.of(amount, SYP))).toBe(true);
  });

  it("reports why text is not an amount", () => {
    expect(readMoneyInput("  ", SYP).problem).toBe("required");
    expect(readMoneyInput("12a", SYP).problem).toBe("notANumber");
    expect(readMoneyInput("1.005", SYP).problem).toBe("tooPrecise");
    expect(readMoneyInput("-1", SYP).problem).toBe("negative");
  });

  it("takes a wider scale for unit prices and negatives when allowed", () => {
    expect(readMoneyInput("1.005", SYP, { scale: 6 }).money?.amount.toString()).toBe("1.005");
    expect(readMoneyInput("-1", SYP, { allowNegative: true }).money?.isNegative()).toBe(true);
  });
});

describe("MoneyInput", () => {
  function Harness({ onCurrency }: { onCurrency: (code: string) => void }) {
    const [amount, setAmount] = useState("");
    const [currency, setCurrency] = useState(SYP);
    const result = amount === "" ? undefined : readMoneyInput(amount, currency);
    return (
      <>
        <MoneyInput
          label="السعر"
          amount={amount}
          onAmountChange={setAmount}
          currency={currency}
          currencies={[SYP, USD]}
          onCurrencyChange={(chosen) => {
            setCurrency(chosen);
            onCurrency(chosen.code);
          }}
          problem={result?.problem}
        />
        <output>{result?.money?.amount.toString()}</output>
      </>
    );
  }

  it("reads Arabic-Indic digits as an exact amount and switches currency with arrow keys", async () => {
    const onCurrency = vi.fn();
    wrap(<Harness onCurrency={onCurrency} />);
    const input = screen.getByLabelText("السعر");
    expect(input).toHaveAttribute("dir", "ltr");
    expect(input).toHaveAttribute("inputmode", "decimal");
    await userEvent.type(input, "١٢٫٥");
    expect(screen.getByRole("status")).toHaveTextContent("12.5");

    await userEvent.tab();
    expect(screen.getByRole("radio", { name: "ل.س" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(onCurrency).toHaveBeenLastCalledWith("USD");
    expect(screen.getByRole("radio", { name: "$" })).toBeChecked();
  });

  it("shows the problem as a translated message", async () => {
    wrap(<Harness onCurrency={vi.fn()} />);
    const input = screen.getByLabelText("السعر");
    await userEvent.type(input, "1.005");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("خانتان عشريتان على الأكثر");
  });

  it("shows the single currency as text when there is no choice", () => {
    wrap(<MoneyInput label="المبلغ" amount="" onAmountChange={vi.fn()} currency={USD} />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByText("$")).toBeInTheDocument();
  });
});

describe("DataTable", () => {
  const rows = [
    { id: "a", name: "شاحن", price: KernelMoney.of("12.5", USD) },
    { id: "b", name: "سماعة", price: KernelMoney.of("150000", SYP) },
  ];
  const columns = [
    { id: "name", header: "الاسم", cell: (row: (typeof rows)[number]) => row.name },
    {
      id: "price",
      header: "السعر",
      align: "end" as const,
      cell: (row: (typeof rows)[number]) => <Money value={row.price} />,
    },
  ];

  it("renders a labelled grid with row headers and end-aligned figures", () => {
    wrap(<DataTable label="المنتجات" columns={columns} rows={rows} rowId={(row) => row.id} />);
    const grid = screen.getByRole("grid", { name: "المنتجات" });
    expect(grid).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("rowheader", { name: "شاحن" })).toBeInTheDocument();
    const priceCell = screen.getByText("150,000.00").closest('[role="gridcell"]');
    expect(priceCell?.className).toMatch(/\btext-end\b.*\btabular-nums\b/);
  });

  it("moves between rows with the arrow keys", async () => {
    wrap(<DataTable label="المنتجات" columns={columns} rows={rows} rowId={(row) => row.id} />);
    await userEvent.tab();
    const [, first, second] = screen.getAllByRole("row");
    expect(first).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(second).toHaveFocus();
  });

  it("says so when there are no rows", () => {
    wrap(<DataTable label="المنتجات" columns={columns} rows={[]} rowId={(row) => row.id} />);
    expect(screen.getByText("لا توجد بيانات بعد")).toBeInTheDocument();
  });
});
