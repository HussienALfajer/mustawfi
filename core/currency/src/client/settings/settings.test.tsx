// @vitest-environment jsdom
import { createI18n } from "@mustawfi/i18n";
import { ToastProvider, UI_NAMESPACE, uiMessages } from "@mustawfi/ui";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currencyProblemCodes,
  type CurrencySettingsOverview,
  saveCurrencySettingsRequestSchema,
} from "../../shared/index.ts";
import { CURRENCY_NAMESPACE, currencyMessages } from "../messages.ts";
import { CurrencySettingsForm } from "./currency-settings-screen.tsx";
import { readSettings, type SettingsValues, settingsValues } from "./settings-values.ts";

const i18n = createI18n({
  [UI_NAMESPACE]: uiMessages,
  [CURRENCY_NAMESPACE]: currencyMessages,
});

const OVERVIEW: CurrencySettingsOverview = {
  baseCurrency: "SYP",
  currencies: [
    { code: "SYP", minorUnits: 2, strengthRank: 3, enabled: true, cashRoundingStep: "10.00" },
    { code: "USD", minorUnits: 2, strengthRank: 1, enabled: true, cashRoundingStep: "0.01" },
    { code: "TRY", minorUnits: 2, strengthRank: 2, enabled: false, cashRoundingStep: "1.00" },
  ],
  settings: { changeCurrency: "SYP", rateChangeThresholdPercent: 10 },
  ratedCurrencies: ["USD"],
};

function values(change: Partial<SettingsValues> = {}): SettingsValues {
  return { ...settingsValues(OVERVIEW), ...change };
}

function withCurrency(
  code: string,
  change: Partial<SettingsValues["currencies"][number]>,
): SettingsValues {
  const base = values();
  return {
    ...base,
    currencies: base.currencies.map((currency) =>
      currency.code === code ? { ...currency, ...change } : currency,
    ),
  };
}

describe("readSettings (rules 2–5)", () => {
  it("builds the server's request from the settings as they stand", () => {
    const read = readSettings(OVERVIEW, values());
    expect(read.request).toEqual({
      currencies: [
        { code: "SYP", enabled: true, cashRoundingStep: "10" },
        { code: "USD", enabled: true, cashRoundingStep: "0.01" },
        { code: "TRY", enabled: false, cashRoundingStep: "1" },
      ],
      changeCurrency: "SYP",
      rateChangeThresholdPercent: 10,
      firstRates: [],
    });
    expect(saveCurrencySettingsRequestSchema.safeParse(read.request).success).toBe(true);
  });

  it.each(["0", "0.001", "1000.01", "-10", "ten", ""])(
    "refuses a cash-rounding step of %j on its field (rule 4)",
    (step) => {
      expect(
        readSettings(OVERVIEW, withCurrency("SYP", { cashRoundingStep: step })).errors,
      ).toEqual({
        "currencies.SYP.cashRoundingStep": "stepInvalid",
      });
    },
  );

  it.each(["0", "101", "10.5", "", "abc"])("refuses a threshold of %j (rule 5)", (threshold) => {
    expect(readSettings(OVERVIEW, values({ threshold })).errors).toEqual({
      threshold: "thresholdInvalid",
    });
  });

  it("asks for the first rate of a currency enabled now without one, and takes it (rule 2)", () => {
    expect(readSettings(OVERVIEW, withCurrency("TRY", { enabled: true })).errors).toEqual({
      "currencies.TRY.firstRate": "firstRateRequired",
    });
    expect(
      readSettings(OVERVIEW, withCurrency("TRY", { enabled: true, firstRate: "0" })).errors,
    ).toEqual({ "currencies.TRY.firstRate": "rateInvalid" });
    expect(
      readSettings(OVERVIEW, withCurrency("TRY", { enabled: true, firstRate: "٤٫٢٥" })).request
        ?.firstRates,
    ).toEqual([{ currency: "TRY", rate: "4.25" }]);
  });

  it("leaves the first rate optional for a currency already enabled without one", () => {
    const unrated = { ...OVERVIEW, ratedCurrencies: [] };
    expect(readSettings(unrated, values()).request?.firstRates).toEqual([]);
    expect(
      readSettings(unrated, withCurrency("USD", { firstRate: "122" })).request?.firstRates,
    ).toEqual([{ currency: "USD", rate: "122" }]);
  });

  it("keeps the change currency enabled (rule 3)", () => {
    expect(
      readSettings(OVERVIEW, {
        ...withCurrency("USD", { enabled: false }),
        changeCurrency: "USD",
      }).errors,
    ).toEqual({ changeCurrency: "changeCurrencyDisabled" });
  });

  it("keeps the base enabled whatever the form says (rule 2)", () => {
    expect(
      readSettings(OVERVIEW, withCurrency("SYP", { enabled: false })).request?.currencies[0],
    ).toEqual({ code: "SYP", enabled: true, cashRoundingStep: "10" });
  });
});

let puts: unknown[];
let answer: () => Response;

beforeEach(() => {
  puts = [];
  answer = () => Response.json(OVERVIEW);
  vi.stubGlobal("fetch", (_url: string, init: RequestInit = {}) => {
    if (init.method === "PUT") puts.push(JSON.parse(init.body as string));
    return Promise.resolve(answer());
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderForm() {
  const onDirtyChange = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <div dir="rtl">
            <CurrencySettingsForm overview={OVERVIEW} onDirtyChange={onDirtyChange} />
          </div>
        </ToastProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { onDirtyChange };
}

describe("CurrencySettingsForm", () => {
  it("shows the currencies, the base marked always enabled, and the settings", () => {
    renderForm();
    expect(screen.getByRole("checkbox", { name: /الليرة السورية/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /الليرة السورية/ })).toHaveAccessibleDescription(
      "العملة الأساسية: مفعّلة دائمًا.",
    );
    expect(screen.getByRole("checkbox", { name: /الدولار الأمريكي/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /الليرة التركية/ })).not.toBeChecked();
    expect(screen.getByRole("textbox", { name: "خطوة تقريب ل.س" })).toHaveValue("10");
    expect(screen.getByRole("textbox", { name: "النسبة (%)" })).toHaveValue("10");
    expect(screen.queryByRole("textbox", { name: /السعر الأول/ })).toBeNull();
  });

  it("asks for the first rate when enabling a currency without one, and sends it", async () => {
    const user = userEvent.setup();
    const { onDirtyChange } = renderForm();
    await user.click(screen.getByRole("checkbox", { name: /الليرة التركية/ }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("تغييرات غير محفوظة")).toBeInTheDocument();
    const firstRate = screen.getByRole("textbox", { name: "السعر الأول (ل.س لكل 1 ل.ت)" });
    await user.click(screen.getByRole("button", { name: /حفظ/ }));
    expect(firstRate).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("أدخل السعر الأول لتفعيل هذه العملة.")).toBeInTheDocument();
    expect(puts).toEqual([]);
    await user.type(firstRate, "4.25");
    await user.keyboard("{Control>}s{/Control}");
    await waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    expect(puts[0]).toMatchObject({
      currencies: [
        { code: "SYP", enabled: true },
        { code: "USD", enabled: true },
        { code: "TRY", enabled: true, cashRoundingStep: "1" },
      ],
      firstRates: [{ currency: "TRY", rate: "4.25" }],
    });
    expect(await screen.findByText("حُفظت إعدادات العملات.")).toBeInTheDocument();
  });

  it("says a step and a threshold out of bounds on their fields, and sends nothing", async () => {
    const user = userEvent.setup();
    renderForm();
    const step = screen.getByRole("textbox", { name: "خطوة تقريب $" });
    await user.clear(step);
    await user.type(step, "0.005");
    const threshold = screen.getByRole("textbox", { name: "النسبة (%)" });
    await user.clear(threshold);
    await user.type(threshold, "150");
    await user.click(screen.getByRole("button", { name: /حفظ/ }));
    expect(step).toHaveAttribute("aria-invalid", "true");
    expect(threshold).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("بعض القيم غير صالحة");
    expect(puts).toEqual([]);
  });

  it("offers only enabled currencies for change once one is switched off (rule 3)", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("checkbox", { name: /الدولار الأمريكي/ }));
    await user.click(screen.getByRole("button", { name: /عملة الباقي/ }));
    // Only enabled currencies are offered for change.
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["الليرة السورية"]);
  });

  it("puts the server's refusal of the change currency on its field", async () => {
    answer = () =>
      Response.json(
        {
          type: "about:blank",
          title: "t",
          status: 409,
          code: currencyProblemCodes.changeCurrencyInUse,
        },
        { status: 409 },
      );
    const user = userEvent.setup();
    renderForm();
    const threshold = screen.getByRole("textbox", { name: "النسبة (%)" });
    await user.clear(threshold);
    await user.type(threshold, "20");
    await user.click(screen.getByRole("button", { name: /حفظ/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("عملة الباقي يجب أن تكون مفعّلة");
    // What was typed stays.
    expect(threshold).toHaveValue("20");
  });

  it("discards the changes, and offers discard only while there are some", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.queryByRole("button", { name: "تراجع عن التغييرات" })).toBeNull();
    const threshold = screen.getByRole("textbox", { name: "النسبة (%)" });
    await user.clear(threshold);
    await user.type(threshold, "30");
    await user.click(screen.getByRole("button", { name: "تراجع عن التغييرات" }));
    expect(threshold).toHaveValue("10");
    expect(screen.queryByRole("button", { name: "تراجع عن التغييرات" })).toBeNull();
    expect(within(document.body).queryByText("تغييرات غير محفوظة")).toBeNull();
  });
});
