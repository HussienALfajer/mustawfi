// @vitest-environment jsdom
import { ClientRuntimeProvider } from "@mustawfi/core-config/client";
import { syncLocalMigrations } from "@mustawfi/core-sync/client";
import { tenancyLocalMigrations } from "@mustawfi/core-tenancy/client";
import { createI18n } from "@mustawfi/i18n";
import { cryptoRandom, manualClock, uuidV7Generator } from "@mustawfi/kernel";
import { type LocalDb, LocalDbProvider, migrateLocalDb } from "@mustawfi/local-db";
import { openNodeLocalDb } from "@mustawfi/local-db/node";
import { ToastProvider, UI_NAMESPACE, uiMessages } from "@mustawfi/ui";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CURRENCY_SETTINGS_ENTITY,
  EXCHANGE_RATE_ENTITY,
  RATE_SET_OPERATION,
  TENANT_CURRENCY_ENTITY,
  type TenantCurrencyView,
} from "../../shared/index.ts";
import {
  currencyLocalMigrations,
  currencyPullAppliers,
  listLocalCurrentRates,
} from "../local-currency.ts";
import { CURRENCY_NAMESPACE, currencyMessages } from "../messages.ts";
import { DeviceRatesScreen, type RateSetOutcome, RatesView } from "./rates-screen.tsx";
import {
  isStaleRate,
  type NewRate,
  rateChangeToConfirm,
  rateExample,
  type RateLine,
  type RatesData,
  staleCurrencies,
} from "./rates.ts";
import { StaleRateNotice } from "./stale-rate-banner.tsx";

const i18n = createI18n({
  [UI_NAMESPACE]: uiMessages,
  [CURRENCY_NAMESPACE]: currencyMessages,
});

const OWNER = "0190a000-0000-7000-8000-00000000a001";
const DEVICE = { deviceId: "0190a000-0000-7000-8000-00000000d001", baseCurrency: "SYP" };
const SHIFT = "0190a000-0000-7000-8000-00000000c001";

/** 2026-09-28 10:00 in Damascus (UTC+3). */
const NOW = new Date("2026-09-28T07:00:00.000Z");

const USD: TenantCurrencyView = {
  code: "USD",
  minorUnits: 2,
  strengthRank: 1,
  enabled: true,
  cashRoundingStep: "0.01",
};
const TRY: TenantCurrencyView = {
  code: "TRY",
  minorUnits: 2,
  strengthRank: 2,
  enabled: true,
  cashRoundingStep: "1.00",
};

function line(change: Partial<RateLine> = {}): RateLine {
  return {
    id: "0190a000-0000-7000-8000-000000000101",
    unitCurrency: "USD",
    quoteCurrency: "SYP",
    rate: "122",
    effectiveAt: "2026-09-28T05:30:00.000Z",
    setBy: OWNER,
    setByName: "أحمد",
    source: "online",
    deviceName: null,
    pending: false,
    ...change,
  };
}

function data(change: Partial<RatesData> = {}): RatesData {
  const current = line();
  return {
    baseCurrency: "SYP",
    foreign: [USD],
    thresholdPercent: 10,
    current: [current],
    history: [current],
    ...change,
  };
}

function wrap(children: ReactNode, queryClient = new QueryClient()) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <div dir="rtl">{children}</div>
        </ToastProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

function renderView(props: {
  readonly data?: RatesData;
  readonly canSet?: boolean;
  readonly outcome?: (rate: NewRate) => RateSetOutcome;
}) {
  const onSetRate = vi.fn((rate: NewRate) =>
    Promise.resolve(props.outcome?.(rate) ?? ({ status: "saved" } as const)),
  );
  render(
    wrap(
      <RatesView
        data={props.data ?? data()}
        now={NOW}
        canSet={props.canSet ?? true}
        onSetRate={onSetRate}
      />,
    ),
  );
  return { onSetRate };
}

afterEach(() => {
  cleanup();
});

describe("rates logic", () => {
  it("marks a rate stale from the start of the business day in Damascus (rule 12)", () => {
    // 23:59 on the 27th in Damascus, then midnight of the 28th.
    const lastMinute = { effectiveAt: "2026-09-27T20:59:00.000Z" };
    expect(isStaleRate(lastMinute, new Date("2026-09-27T20:59:30.000Z"))).toBe(false);
    expect(isStaleRate(lastMinute, new Date("2026-09-27T21:00:00.000Z"))).toBe(true);
    expect(isStaleRate({ effectiveAt: "2026-09-27T21:00:00.000Z" }, NOW)).toBe(false);
  });

  it("names every enabled foreign currency with an old rate or none, never the base", () => {
    const old = line({ effectiveAt: "2026-09-27T12:00:00.000Z" });
    expect(staleCurrencies(data({ foreign: [USD, TRY], current: [old] }), NOW)).toEqual([
      { currency: "USD", state: "old", rate: old },
      { currency: "TRY", state: "missing" },
    ]);
    expect(staleCurrencies(data(), NOW)).toEqual([]);
    expect(staleCurrencies(data({ foreign: [] }), NOW)).toEqual([]);
  });

  it("gives the example in the pair's quote currency, rounded once (rule 11)", () => {
    const example = rateExample({ unitCurrency: "USD", quoteCurrency: "SYP" }, "12200");
    expect(example.from.toString()).toBe("100.00 USD");
    expect(example.to.toString()).toBe("1220000.00 SYP");
    // A USD-base store's lira: TRY per 1 USD.
    expect(
      rateExample({ unitCurrency: "USD", quoteCurrency: "TRY" }, "41.123456").to.toString(),
    ).toBe("4112.35 TRY");
  });

  it("asks for confirmation only beyond the threshold, either way, as the server compares", () => {
    const current = line({ rate: "100" });
    expect(rateChangeToConfirm(current, "110", 10)).toBeUndefined();
    expect(rateChangeToConfirm(current, "90", 10)).toBeUndefined();
    expect(rateChangeToConfirm(current, "110.000001", 10)?.percent).toBe("10");
    expect(rateChangeToConfirm(current, "89.99", 10)?.percent).toBe("-10.01");
    expect(rateChangeToConfirm(undefined, "1000000", 10)).toBeUndefined();
  });
});

describe("RatesView", () => {
  it("shows the current rate with its direction, when and by whom it was set", () => {
    renderView({});
    const section = screen.getByRole("region", { name: "الدولار الأمريكي" });
    expect(within(section).getByText("122")).toBeInTheDocument();
    expect(within(section).getAllByText("ل.س لكل 1 $").length).toBeGreaterThan(0);
    expect(within(section).getByText(/بواسطة أحمد/)).toBeInTheDocument();
    expect(within(section).queryByText("هذا السعر محدَّد قبل يوم العمل الحالي.")).toBeNull();
  });

  it("marks yesterday's rate, and says a currency without a rate cannot be used (rule 12)", () => {
    renderView({
      data: data({
        foreign: [USD, TRY],
        current: [line({ effectiveAt: "2026-09-27T09:00:00.000Z" })],
      }),
    });
    const dollar = screen.getByRole("region", { name: "الدولار الأمريكي" });
    expect(within(dollar).getByText("هذا السعر محدَّد قبل يوم العمل الحالي.")).toBeInTheDocument();
    const lira = screen.getByRole("region", { name: "الليرة التركية" });
    expect(within(lira).getByText(/لم يُحدَّد سعر بعد/)).toBeInTheDocument();
  });

  it("sets a rate within the threshold at once, with Enter, and confirms it saved", async () => {
    const user = userEvent.setup();
    const { onSetRate } = renderView({});
    await user.type(screen.getByRole("textbox", { name: /السعر الجديد/ }), "125.5{Enter}");
    expect(onSetRate).toHaveBeenCalledWith({
      currency: "USD",
      unitCurrency: "USD",
      quoteCurrency: "SYP",
      rate: "125.5",
      confirmed: false,
    });
    expect(await screen.findByText("حُفظ سعر الدولار الأمريكي: 125.5")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /السعر الجديد/ })).toHaveValue("");
  });

  it("confirms an old-pound rate with the change and an example before sending it (rule 11)", async () => {
    const user = userEvent.setup();
    const { onSetRate } = renderView({});
    await user.type(screen.getByRole("textbox", { name: /السعر الجديد/ }), "12200");
    await user.click(screen.getByRole("button", { name: "حفظ السعر" }));
    const dialog = await screen.findByRole("alertdialog", { name: "تأكيد تغيّر السعر" });
    expect(within(dialog).getByText("+9,900%")).toBeInTheDocument();
    expect(within(dialog).getByText("12,200")).toBeInTheDocument();
    expect(within(dialog).getByText("100.00")).toBeInTheDocument();
    expect(within(dialog).getByText("1,220,000.00")).toBeInTheDocument();
    expect(onSetRate).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "تأكيد السعر" }));
    expect(onSetRate).toHaveBeenCalledWith(
      expect.objectContaining({ rate: "12200", confirmed: true }),
    );
  });

  it("goes back to the rate without sending it when the confirmation is refused", async () => {
    const user = userEvent.setup();
    const { onSetRate } = renderView({});
    await user.type(screen.getByRole("textbox", { name: /السعر الجديد/ }), "50{Enter}");
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "مراجعة السعر" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onSetRate).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: /السعر الجديد/ })).toHaveValue("50");
  });

  it("says on the field what a rate must be, and sends nothing", async () => {
    const user = userEvent.setup();
    const { onSetRate } = renderView({});
    for (const typed of ["0", "-5", "1000000000000", "1.1234567", "abc"]) {
      const field = screen.getByRole("textbox", { name: /السعر الجديد/ });
      await user.clear(field);
      await user.type(field, `${typed}{Enter}`);
      expect(field).toHaveAttribute("aria-invalid", "true");
    }
    expect(onSetRate).not.toHaveBeenCalled();
  });

  it("takes Arabic-Indic digits and a decimal comma as typed on a phone", async () => {
    const user = userEvent.setup();
    const { onSetRate } = renderView({});
    await user.type(screen.getByRole("textbox", { name: /السعر الجديد/ }), "١٢٣٫٥{Enter}");
    expect(onSetRate).toHaveBeenCalledWith(expect.objectContaining({ rate: "123.5" }));
  });

  it("keeps what was typed and says why when the rate is refused", async () => {
    const user = userEvent.setup();
    renderView({ outcome: () => ({ status: "refused", problem: "unreachable" }) });
    await user.type(screen.getByRole("textbox", { name: /السعر الجديد/ }), "123{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("لا يوجد اتصال بالخادم");
    expect(screen.getByRole("textbox", { name: /السعر الجديد/ })).toHaveValue("123");
  });

  it("says the rate was not saved when saving fails unexpectedly", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderView({
      outcome: () => {
        throw new Error("the local database is locked");
      },
    });
    await user.type(screen.getByRole("textbox", { name: /السعر الجديد/ }), "123{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("لم يُحفظ السعر. أعد المحاولة.");
    expect(screen.getByRole("textbox", { name: /السعر الجديد/ })).toHaveValue("123");
  });

  it("sends a rate once however many times Enter is pressed while it saves", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const onSetRate = vi.fn(
      () =>
        new Promise<RateSetOutcome>((resolve) => {
          release = () => {
            resolve({ status: "saved" });
          };
        }),
    );
    render(wrap(<RatesView data={data()} now={NOW} canSet onSetRate={onSetRate} />));
    await user.type(screen.getByRole("textbox", { name: /السعر الجديد/ }), "123{Enter}{Enter}");
    expect(onSetRate).toHaveBeenCalledTimes(1);
    release();
    expect(await screen.findByText("حُفظ سعر الدولار الأمريكي: 123")).toBeInTheDocument();
  });

  it("opens the confirmation when a newer rate arrived meanwhile", async () => {
    const user = userEvent.setup();
    const { onSetRate } = renderView({
      outcome: (rate) =>
        rate.confirmed
          ? { status: "saved" }
          : (() => {
              const change = rateChangeToConfirm(line({ rate: "150" }), rate.rate, 10);
              if (change === undefined) throw new Error("no change");
              return { status: "confirm", change };
            })(),
    });
    await user.type(screen.getByRole("textbox", { name: /السعر الجديد/ }), "123{Enter}");
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "تأكيد السعر" }));
    expect(onSetRate).toHaveBeenLastCalledWith(expect.objectContaining({ confirmed: true }));
  });

  it("shows only the rates to a user without currency.rate.set", () => {
    renderView({ canSet: false });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("يسمح لك دورك بالاطلاع على الأسعار فقط.")).toBeInTheDocument();
  });

  it("lists the latest rates with where each was set, the pending and the current", () => {
    const current = line({
      id: "0190a000-0000-7000-8000-000000000103",
      rate: "124",
      source: "thisDevice",
      pending: true,
      setByName: null,
    });
    renderView({
      data: data({
        current: [current],
        history: [
          current,
          line({
            id: "0190a000-0000-7000-8000-000000000102",
            rate: "123",
            source: "otherDevice",
            deviceName: "جوال المالك",
          }),
          line(),
        ],
      }),
    });
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[4]?.textContent)).toEqual([
      "هذا الجهازبانتظار المزامنةالحالي",
      "جوال المالك",
      "عبر الإنترنت",
    ]);
    expect(within(rows[0] as HTMLElement).getByText("مستخدم آخر")).toBeInTheDocument();
  });
});

describe("StaleRateNotice", () => {
  it("says which rate predates the day and which is missing, with the action for those who may", () => {
    render(
      wrap(
        <StaleRateNotice
          data={data({
            foreign: [USD, TRY],
            current: [line({ effectiveAt: "2026-09-27T09:00:00.000Z" })],
          })}
          now={NOW}
          setRate={(label) => <a href="/rates">{label}</a>}
        />,
      ),
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/سعر الدولار الأمريكي محدَّد قبل اليوم/);
    expect(banner).toHaveTextContent("البيع مستمر بالسعر الحالي.");
    expect(banner).toHaveTextContent("لم يُحدَّد سعر الليرة التركية بعد");
    expect(within(banner).getByRole("link", { name: "تحديد السعر" })).toHaveAttribute(
      "href",
      "/rates",
    );
  });

  it("offers no action to a user who may not set the rate, and is absent while rates are current", () => {
    const { rerender } = render(
      wrap(
        <StaleRateNotice
          data={data({ current: [line({ effectiveAt: "2026-09-27T09:00:00.000Z" })] })}
          now={NOW}
        />,
      ),
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    rerender(wrap(<StaleRateNotice data={data()} now={NOW} />));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("DeviceRatesScreen", () => {
  let db: LocalDb;

  afterEach(async () => {
    await db.close();
  });

  async function openDevice(): Promise<void> {
    db = openNodeLocalDb(":memory:");
    await migrateLocalDb(db, [
      ...syncLocalMigrations,
      ...tenancyLocalMigrations,
      ...currencyLocalMigrations,
    ]);
    const appliers = new Map(currencyPullAppliers.map((applier) => [applier.entity, applier]));
    const changes = [
      ...[
        { code: "SYP", minorUnits: 2, strengthRank: 3, enabled: true, cashRoundingStep: "10.00" },
        { ...USD },
        { ...TRY, enabled: false },
      ].map((row, i) => ({
        entity: TENANT_CURRENCY_ENTITY,
        id: `0190a000-0000-7000-8000-00000000e00${String(i)}`,
        row,
      })),
      {
        entity: CURRENCY_SETTINGS_ENTITY,
        id: "0190a000-0000-7000-8000-00000000e010",
        row: { changeCurrency: "SYP", rateChangeThresholdPercent: 10 },
      },
      {
        entity: EXCHANGE_RATE_ENTITY,
        id: "0190a000-0000-7000-8000-00000000e020",
        row: {
          id: "0190a000-0000-7000-8000-00000000e020",
          unitCurrency: "USD",
          quoteCurrency: "SYP",
          rate: "122",
          effectiveAt: "2026-09-28T05:00:00.000Z",
          recordedAt: "2026-09-28T05:00:00.000Z",
          setBy: OWNER,
          deviceId: null,
          opId: null,
        },
      },
    ];
    await db.transaction(async (tx) => {
      for (const change of changes) await appliers.get(change.entity)?.apply(tx, change);
    });
  }

  function renderDevice(onRateSet: () => void) {
    const clock = manualClock(NOW);
    const runtime = {
      clock,
      newId: uuidV7Generator({ clock, random: cryptoRandom }),
      audit: { record: () => Promise.resolve() },
    };
    render(
      <ClientRuntimeProvider runtime={runtime}>
        <LocalDbProvider db={db}>
          {wrap(
            <DeviceRatesScreen
              device={DEVICE}
              userId={OWNER}
              shiftId={SHIFT}
              canSet
              userName={(id) => (id === OWNER ? "أحمد" : undefined)}
              onRateSet={onRateSet}
            />,
            new QueryClient({ defaultOptions: { queries: { retry: false } } }),
          )}
        </LocalDbProvider>
      </ClientRuntimeProvider>,
    );
  }

  it("sets the rate on the device offline: current here at once, queued for the server", async () => {
    await openDevice();
    const onRateSet = vi.fn();
    const user = userEvent.setup();
    renderDevice(onRateSet);
    const section = await screen.findByRole("region", { name: "الدولار الأمريكي" });
    expect(within(section).getByText(/بواسطة أحمد/)).toBeInTheDocument();
    await user.type(within(section).getByRole("textbox", { name: /السعر الجديد/ }), "124{Enter}");
    await waitFor(() => {
      expect(onRateSet).toHaveBeenCalledTimes(1);
    });
    const current = await listLocalCurrentRates(db);
    expect(current.map((rate) => [rate.rate, rate.recordedAt, rate.deviceId])).toEqual([
      ["124", null, DEVICE.deviceId],
    ]);
    const outbox = await db.query("SELECT type, payload FROM sync_outbox");
    expect(outbox.map((row) => row["type"])).toEqual([RATE_SET_OPERATION]);
    expect(JSON.parse(String(outbox[0]?.["payload"] ?? "{}"))).toMatchObject({
      rate: "124",
      confirmed: false,
    });
  });

  it("asks the device's threshold before an old-pound rate, and records the confirmation", async () => {
    await openDevice();
    const onRateSet = vi.fn();
    const user = userEvent.setup();
    renderDevice(onRateSet);
    const field = await screen.findByRole("textbox", { name: /السعر الجديد/ });
    await user.type(field, "12200{Enter}");
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("+9,900%")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "تأكيد السعر" }));
    await waitFor(() => {
      expect(onRateSet).toHaveBeenCalledTimes(1);
    });
    const outbox = await db.query("SELECT payload FROM sync_outbox");
    expect(JSON.parse(String(outbox[0]?.["payload"] ?? "{}"))).toMatchObject({
      rate: "12200",
      confirmed: true,
    });
  });
});
