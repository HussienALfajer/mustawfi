import { encodeReceipt, type ReceiptCommands } from "./escpos.ts";
import type { ReceiptFonts } from "./fonts.ts";
import { PAPER_DOTS, type PaperWidth, type Raster, toMonochrome } from "./raster.ts";
import { rasterizeHtml } from "./rasterize.ts";
import { renderTemplate } from "./template.ts";
import type { RawPrinterTransport } from "./transport.ts";

/** How long each step took, in milliseconds (`performance.now`). */
export interface ReceiptTimings {
  readonly render: number;
  readonly rasterize: number;
  readonly encode: number;
  /** Handing the bytes to the spooler; absent when nothing was sent. */
  readonly send?: number;
  readonly total: number;
}

export interface ReceiptJob {
  /** Print template source (HTML with LiquidJS variables) and its data. */
  readonly template: string;
  readonly data: object;
  readonly paper: PaperWidth;
  readonly commands: ReceiptCommands;
  readonly fonts: ReceiptFonts;
}

export interface PreparedReceipt {
  /** The 1-bit image the printer burns, as RGBA. */
  readonly raster: Raster;
  readonly bytes: Uint8Array;
  readonly timings: ReceiptTimings;
}

/** Template → HTML → raster → 1-bit → ESC/POS, timing each step. Browser only. */
export async function prepareReceipt(job: ReceiptJob): Promise<PreparedReceipt> {
  const start = performance.now();
  const html = renderTemplate(job.template, job.data);
  const rendered = performance.now();
  const raster = toMonochrome(await rasterizeHtml(html, PAPER_DOTS[job.paper], job.fonts));
  const rasterized = performance.now();
  const bytes = encodeReceipt(raster, job.commands);
  const encoded = performance.now();
  return {
    raster,
    bytes,
    timings: {
      render: rendered - start,
      rasterize: rasterized - rendered,
      encode: encoded - rasterized,
      total: encoded - start,
    },
  };
}

export interface PrintedReceipt extends PreparedReceipt {
  readonly jobId: number;
}

/** Prepares a receipt and sends it: the whole receipt-to-printer path of ADR-0025. */
export async function printReceipt(
  job: ReceiptJob & {
    readonly transport: RawPrinterTransport;
    readonly printer: string;
    readonly documentName: string;
  },
): Promise<PrintedReceipt> {
  const start = performance.now();
  const prepared = await prepareReceipt(job);
  const sending = performance.now();
  const jobId = await job.transport.printRaw(job.printer, job.documentName, prepared.bytes);
  const sent = performance.now();
  return {
    ...prepared,
    jobId,
    timings: { ...prepared.timings, send: sent - sending, total: sent - start },
  };
}
