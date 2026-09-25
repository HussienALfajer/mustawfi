# 0025. Print receipts as rasterized HTML templates encoded to ESC/POS, sent through native transports; scan with HID input and ML Kit

- Status: Accepted
- Date: 2026-09-25

## Context

ESC/POS thermal printers render Arabic unreliably, so receipts must be printed as images (AGENTS.md). Templates are versioned and tenant-editable (ADR-0009). Printing must work offline and never wait for the server. Printers connect by USB, network, and Bluetooth; the cash drawer opens through the printer. Phones scan with the camera (ADR-0011); tills use HID laser scanners.

## Decision

**Templates:** print templates are HTML/CSS with LiquidJS variables (`{{ customer.name }}`). LiquidJS is chosen because tenant-editable templates must not execute code, and LiquidJS has no code execution. Each document stores the template version it printed with.

**Receipt pipeline (client-side, offline):**

1. Render the template into an offscreen container of the printer's dot width: 384 dots for 58 mm, 576 for 80 mm, at 203 dpi.
2. Rasterize it to a canvas with the bundled fonts.
3. Convert to 1-bit (threshold, or dithering for logos).
4. Encode ESC/POS raster commands with `@point-of-sale/receipt-printer-encoder`, which also handles paper cut and the drawer kick (`ESC p`).
5. Send the bytes through the platform transport.

The rasterizer (DOM-to-canvas library, or a Canvas 2D layout fallback) is chosen by a spike in the walking skeleton that measures speed on low-end hardware; the target is receipt-to-printer in under 1 s.

**Transports:**
- **Windows (Tauri, Rust commands):** Windows spooler in RAW mode (USB printers with an installed driver), TCP 9100 (network printers), serial/COM.
- **Android (Capacitor):** Bluetooth SPP, USB host, and TCP, through a small Capacitor plugin of our own or a vetted community plugin — chosen against the certified printers in the `sales` unit.
- The browser is not a printing client in V1.

**Digital receipt:** the same raster, exported as PNG, or as a PDF wrapping the image, to share by WhatsApp link. No separate Arabic PDF text layout.

**A4 invoices and reports:** HTML/CSS print styles, printed or saved as PDF through the platform's print pipeline (WebView2 print-to-PDF on Windows, `PrintManager` on Android). No server-side PDF rendering in V1.

**Labels:** one certified label printer, driven with raster bitmaps in its native language (TSPL or ZPL).

**Scanning:**
- **HID laser scanners** type like keyboards. `ScanInput` recognizes a burst (very short gaps between keys, ending in Enter), keeps focus on the scan field, and never lets a scan land in another field.
- **Android camera:** `@capacitor-mlkit/barcode-scanning` (Google ML Kit) in continuous mode. IMEI detection (15 digits with a valid Luhn check digit) and classification of the other box barcodes live in shared code of the `serials` module.
- **Browser camera scanning:** not relied on (ADR-0010, ADR-0012).

The certified hardware list is kept in `docs/product/hardware.md` (business track).

## Consequences

- One rendering path serves thermal receipts, digital receipts, and reprints, so reprints match the original.
- Native code is limited to byte transports, not layout.
- Printer quirks are handled once, in the encoder library and our transport layer, and tested on every certified model before launch (launch gate).

### Spike result (walking-skeleton slice 14, 2026-09-25)

- **Rasterizer: `modern-screenshot` 4.7** (DOM → SVG `foreignObject` → canvas), one CSS pixel per dot, in a hidden, sandboxed (`allow-same-origin`, no scripts), standards-mode `iframe` that holds only the receipt font. The Canvas 2D fallback was not needed and was not built. Code: `packages/printing` (`@mustawfi/printing`).
- **The receipt font belongs to the pipeline:** IBM Plex Sans Arabic 400/700, Arabic and Latin subsets, bundled with the app, loaded once at start-up and inlined as `@font-face` data URLs under the family `Mustawfi Receipt`. Left to collect the page's fonts, the library dropped the Latin subset (spaces and digits), so the drawing used another font than the layout and lines broke apart. In the app's own document, app CSS leaked into receipts and copying computed styles was slow; the isolated frame fixes both, and its sandbox keeps a tenant template's event attributes from running.
- **Encoder:** `@point-of-sale/receipt-printer-encoder` 4.0.1, raster mode (`GS v 0`, chunks of at most 255 rows), threshold at luminance 128 applied once before encoding, so the preview is the printed bits.
- **Windows transport:** our own crate `mustawfi-printing` over `windows-sys` (winspool: `OpenPrinterW`, `StartDocPrinterW` with datatype `RAW`, `WritePrinter` until every byte is taken, `AbortPrinter` on any failure). The `printers` crate was rejected: it ignores `WritePrinter`'s result and byte count, so a failed write reports success. This crate is the only one allowed `unsafe` (denied instead of forbidden, and allowed in `winspool.rs` only).
- **Measured** (template → HTML → raster → 1-bit → ESC/POS, 80 mm, short receipt): development PC (i9-14900HX), release Windows app (WebView2 153): 48–154 ms, about 95 ms warm; browser app: 52–107 ms. Under DevTools 6× CPU throttling: the pipeline alone 0.5–0.6 s, inside the running POS 0.8–4.4 s (main-thread contention from the app itself). **Not yet measured on reference low-end hardware, nor with a real printer's send time** — left to walking-skeleton slice 15, which confirms or revisits this choice. Slice 15 moved to the `sales` unit when the walking skeleton closed (2026-09-25, no printer available).

## Alternatives considered

- **ESC/POS text mode with Arabic code pages** — unreliable shaping and joining across printer models.
- **Server-side PDF or image rendering** — requires the network, which a receipt must never wait for.
- **Handlebars or other code-capable templates** — tenant-editable templates must not run code.
- **WebUSB or WebBluetooth printing from the browser** — unsupported on Safari and fragile elsewhere.
