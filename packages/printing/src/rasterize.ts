import { domToCanvas } from "modern-screenshot";
import type { ReceiptFonts } from "./fonts.ts";
import type { Raster } from "./raster.ts";

/**
 * The document receipts are laid out in: a hidden, sandboxed `iframe` holding only the
 * receipt font. The app's styles do not reach a receipt, so it looks the same on every client;
 * the sandbox runs no script, so a tenant's template cannot run code through an event
 * attribute; and a small document keeps copying computed styles cheap (in the app's own
 * document, that copy took seconds on a throttled CPU). One frame per font set, reused.
 */
interface ReceiptFrame {
  readonly document: Document;
  /** Receipts are drawn one at a time in a frame. */
  queue: Promise<unknown>;
}

const frames = new WeakMap<ReceiptFonts, Promise<ReceiptFrame>>();

async function receiptFrame(fonts: ReceiptFonts): Promise<ReceiptFrame> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.sandbox.add("allow-same-origin");
  iframe.style.cssText =
    "position:fixed;top:0;inset-inline-start:-100000px;inline-size:1px;block-size:1px;border:0;pointer-events:none;";
  // A doctype, so the frame lays out in standards mode: an `about:blank` frame is in quirks
  // mode, where tables do not inherit the font size and receipt lines printed smaller.
  iframe.srcdoc = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>${fonts.cssText}
html, body { margin: 0; background: #fff; color: #000; }</style></head><body></body></html>`;
  const loaded = new Promise<void>((done) => {
    iframe.addEventListener("load", () => done(), { once: true });
  });
  document.body.append(iframe);
  await loaded;
  const frameDocument = iframe.contentDocument;
  if (frameDocument === null) throw new Error("the receipt frame has no document");
  if (frameDocument.compatMode !== "CSS1Compat")
    throw new Error("the receipt frame is in quirks mode");
  return { document: frameDocument, queue: Promise.resolve() };
}

async function drawInFrame(
  frame: ReceiptFrame,
  html: string,
  widthDots: number,
  fonts: ReceiptFonts,
): Promise<Raster> {
  const receipt = frame.document.createElement("div");
  receipt.style.cssText = `width:${String(widthDots)}px;background:#fff;color:#000;`;
  receipt.innerHTML = html;
  frame.document.body.replaceChildren(receipt);
  try {
    // Lay out, and wait for the receipt font's faces the text uses (data URLs, no network).
    void receipt.offsetHeight;
    await frame.document.fonts.ready;
    const canvas = await domToCanvas(receipt, {
      width: widthDots,
      scale: 1,
      backgroundColor: "#ffffff",
      font: { cssText: fonts.cssText },
    });
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2D canvas context");
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: image.width, height: image.height, data: image.data };
  } finally {
    receipt.remove();
  }
}

/**
 * Lays out receipt HTML at the printer's dot width and draws it to pixels (steps 1–2 of
 * ADR-0025). The browser does the layout, so Arabic shapes and joins exactly as on screen;
 * `modern-screenshot` draws the laid-out DOM through an SVG `foreignObject` at one CSS pixel
 * per dot. It embeds only the receipt font it is given: left to collect the page's fonts, it
 * dropped the Latin subset (spaces and digits), so the drawing used another font than the
 * layout and lines broke apart. Works offline: the font is loaded when the app starts.
 *
 * Browser only (it needs a DOM and a canvas).
 */
export async function rasterizeHtml(
  html: string,
  widthDots: number,
  fonts: ReceiptFonts,
): Promise<Raster> {
  let pending = frames.get(fonts);
  if (pending === undefined) {
    pending = receiptFrame(fonts);
    frames.set(fonts, pending);
    // A frame that failed to start is not kept: the next receipt tries again.
    pending.catch(() => frames.delete(fonts));
  }
  const frame = await pending;
  const drawn = frame.queue.then(() => drawInFrame(frame, html, widthDots, fonts));
  frame.queue = drawn.catch(() => undefined);
  return drawn;
}

/** A PNG of a raster, for a preview or a digital receipt (ADR-0025). */
export function rasterToPngUrl(raster: Raster): string {
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas context");
  context.putImageData(
    new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height),
    0,
    0,
  );
  return canvas.toDataURL("image/png");
}
