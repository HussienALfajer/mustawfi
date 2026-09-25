import {
  PAPER_DOTS,
  type ReceiptFonts,
  type PaperWidth,
  prepareReceipt,
  printReceipt,
  type RawPrinterTransport,
  type ReceiptTimings,
  rasterToPngUrl,
} from "@mustawfi/printing";
import { type RecordedInvoiceRef, useReceiptDocument } from "@mustawfi/sales/client";
import { Button } from "@mustawfi/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { SHELL_NAMESPACE } from "./messages.ts";
import { receiptCommands } from "./receipt-commands.ts";

/**
 * What this client prints with (ADR-0025): the receipt font, loaded when the app starts, and
 * the platform's printer transport — the Windows app's spooler, or none: the browser is no
 * printing client; it only previews receipts.
 */
export interface Printing {
  readonly fonts: Promise<ReceiptFonts>;
  readonly transport: RawPrinterTransport | undefined;
}

const PrintingContext = createContext<Printing | undefined>(undefined);

export function PrintingProvider(props: {
  readonly printing: Printing;
  readonly children: ReactNode;
}) {
  return (
    <PrintingContext.Provider value={props.printing}>{props.children}</PrintingContext.Provider>
  );
}

function usePrinting(): Printing {
  const printing = useContext(PrintingContext);
  if (printing === undefined) throw new Error("PrintingProvider is missing");
  return printing;
}

/** This device's receipt printer and what each receipt does. */
export interface PrinterSettings {
  readonly printer: string | null;
  readonly paper: PaperWidth;
  readonly cut: boolean;
  readonly openDrawer: boolean;
}

const DEFAULT_SETTINGS: PrinterSettings = {
  printer: null,
  paper: "mm80",
  cut: true,
  openDrawer: false,
};

/**
 * Kept in the page's storage for the spike; a device setting in the local database comes
 * with the `sales` unit's certified printers.
 */
const SETTINGS_KEY = "mustawfi.printer";

function readSettings(): PrinterSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored === null) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(stored) as Partial<PrinterSettings>;
    return {
      printer: typeof parsed.printer === "string" ? parsed.printer : null,
      paper: parsed.paper === "mm58" ? "mm58" : "mm80",
      cut: parsed.cut !== false,
      openDrawer: parsed.openDrawer === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function usePrinterSettings(): [PrinterSettings, (next: PrinterSettings) => void] {
  const [settings, setSettings] = useState(readSettings);
  return [
    settings,
    (next) => {
      setSettings(next);
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // Not kept past this page; the choice still applies now.
      }
    },
  ];
}

type ReceiptState =
  | { readonly kind: "idle" }
  | { readonly kind: "working" }
  | {
      readonly kind: "done";
      readonly printed: boolean;
      readonly preview: string;
      readonly bytes: number;
      readonly timings: ReceiptTimings;
    }
  | { readonly kind: "failed"; readonly problem: "noPrinter" | "printFailed" | "prepareFailed" };

function milliseconds(value: number | undefined): number {
  return Math.round(value ?? 0);
}

/**
 * A recorded invoice's receipt: preview it (both platforms — the same raster is the digital
 * receipt), or print it on the Windows app. Shows how long each step took (the spike's
 * receipt-to-printer measurement), and a failure stays on screen until the next attempt.
 */
export function ReceiptActions({ invoice }: { readonly invoice: RecordedInvoiceRef }) {
  const { t } = useTranslation(SHELL_NAMESPACE);
  const { fonts, transport } = usePrinting();
  const buildDocument = useReceiptDocument();
  const [settings] = usePrinterSettings();
  const [state, setState] = useState<ReceiptState>({ kind: "idle" });
  const [drawerOpened, setDrawerOpened] = useState(false);

  async function run(print: boolean) {
    const printer = settings.printer;
    if (print && (transport === undefined || printer === null)) {
      setState({ kind: "failed", problem: "noPrinter" });
      return;
    }
    setState({ kind: "working" });
    let stage: "prepareFailed" | "printFailed" = "prepareFailed";
    try {
      const document = await buildDocument(invoice.id, invoice.deviceName);
      const job = {
        template: document.template,
        data: document.data,
        paper: settings.paper,
        commands: receiptCommands(settings, {
          justSold: invoice.justSold,
          drawerAlreadyOpened: drawerOpened,
        }),
        fonts: await fonts,
      };
      if (print && transport !== undefined && printer !== null) {
        stage = "printFailed";
        // Once the drawer kick is sent, this receipt never sends another, even if the job fails.
        if (job.commands.openDrawer) setDrawerOpened(true);
        const printed = await printReceipt({
          ...job,
          transport,
          printer,
          documentName: document.documentName,
        });
        setState({
          kind: "done",
          printed: true,
          preview: rasterToPngUrl(printed.raster),
          bytes: printed.bytes.length,
          timings: printed.timings,
        });
      } else {
        const prepared = await prepareReceipt(job);
        setState({
          kind: "done",
          printed: false,
          preview: rasterToPngUrl(prepared.raster),
          bytes: prepared.bytes.length,
          timings: prepared.timings,
        });
      }
    } catch (error) {
      console.error("the receipt did not print", error);
      setState({ kind: "failed", problem: stage });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          isPending={state.kind === "working"}
          aria-label={t("printing.previewNamed", { number: invoice.number })}
          onPress={() => void run(false)}
        >
          {t("printing.preview")}
        </Button>
        {transport === undefined ? null : (
          <Button
            variant="secondary"
            isPending={state.kind === "working"}
            aria-label={t("printing.printNamed", { number: invoice.number })}
            onPress={() => void run(true)}
          >
            {t("printing.print")}
          </Button>
        )}
      </div>
      {state.kind === "failed" ? (
        <p role="alert" className="text-sm text-text-negative">
          {t(`printing.${state.problem}`)}{" "}
          {state.problem === "noPrinter" ? (
            <Link to="/printer" className="text-text-accent underline">
              {t("printing.choosePrinter")}
            </Link>
          ) : null}
        </p>
      ) : null}
      {state.kind === "done" ? (
        <div className="flex flex-col gap-2">
          <p role="status" className="text-sm text-text-secondary" data-testid="receipt-timings">
            {t(state.printed ? "printing.printed" : "printing.prepared", {
              total: milliseconds(state.timings.total),
              render: milliseconds(state.timings.render),
              rasterize: milliseconds(state.timings.rasterize),
              encode: milliseconds(state.timings.encode),
              send: milliseconds(state.timings.send),
              bytes: state.bytes,
            })}
          </p>
          <img
            src={state.preview}
            alt={t("printing.previewAlt", { number: invoice.number })}
            data-testid="receipt-preview"
            className="border border-divider bg-surface"
            style={{ inlineSize: PAPER_DOTS[settings.paper] / 2 }}
          />
        </div>
      ) : null}
    </div>
  );
}

const SELECT_CLASS =
  "min-h-control w-full min-w-0 rounded-sm border border-field-border bg-field-bg px-pad-inline text-density text-field-text";

/** Choose this device's receipt printer, paper, cut, and drawer kick (Windows app only). */
export function PrinterScreen() {
  const { t } = useTranslation(SHELL_NAMESPACE);
  const { transport } = usePrinting();
  const [settings, setSettings] = usePrinterSettings();
  const printerId = useId();
  const paperId = useId();
  const printers = useQuery({
    queryKey: ["local", "printers"],
    queryFn: () => transport?.listPrinters() ?? Promise.resolve([]),
    enabled: transport !== undefined,
    networkMode: "always",
  });

  let body: ReactNode;
  if (transport === undefined) {
    body = <p className="text-text">{t("printing.browserOnly")}</p>;
  } else if (printers.isError) {
    body = (
      <p role="alert" className="text-text-negative">
        {t("printing.listFailed")}
      </p>
    );
  } else if (printers.data === undefined) {
    body = <p className="text-text-secondary">{t("printing.loading")}</p>;
  } else {
    const known = printers.data.some((printer) => printer.name === settings.printer);
    body = (
      <form className="flex max-w-md flex-col gap-density-gap" onSubmit={(e) => e.preventDefault()}>
        <div className="flex flex-col gap-1">
          <label htmlFor={printerId} className="text-sm font-medium text-text">
            {t("printing.printer")}
          </label>
          <select
            id={printerId}
            className={SELECT_CLASS}
            value={known ? (settings.printer ?? "") : ""}
            onChange={(event) => {
              setSettings({ ...settings, printer: event.target.value || null });
            }}
          >
            <option value="">{t("printing.noneChosen")}</option>
            {printers.data.map((printer) => (
              <option key={printer.name} value={printer.name}>
                {printer.isDefault
                  ? t("printing.defaultPrinter", { name: printer.name })
                  : printer.name}
              </option>
            ))}
          </select>
          {settings.printer !== null && !known ? (
            <p role="alert" className="text-sm text-text-negative">
              {t("printing.missing", { name: settings.printer })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={paperId} className="text-sm font-medium text-text">
            {t("printing.paper")}
          </label>
          <select
            id={paperId}
            className={SELECT_CLASS}
            value={settings.paper}
            onChange={(event) => {
              setSettings({ ...settings, paper: event.target.value === "mm58" ? "mm58" : "mm80" });
            }}
          >
            <option value="mm80">{t("printing.paper80")}</option>
            <option value="mm58">{t("printing.paper58")}</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-text">
          <input
            type="checkbox"
            className="size-5"
            checked={settings.cut}
            onChange={(event) => {
              setSettings({ ...settings, cut: event.target.checked });
            }}
          />
          {t("printing.cut")}
        </label>
        <label className="flex items-center gap-2 text-text">
          <input
            type="checkbox"
            className="size-5"
            checked={settings.openDrawer}
            onChange={(event) => {
              setSettings({ ...settings, openDrawer: event.target.checked });
            }}
          />
          {t("printing.openDrawer")}
        </label>
        <p className="text-sm text-text-secondary">{t("printing.raw")}</p>
      </form>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-text">{t("printing.title")}</h1>
      {body}
    </div>
  );
}
