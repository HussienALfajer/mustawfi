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

## Alternatives considered

- **ESC/POS text mode with Arabic code pages** — unreliable shaping and joining across printer models.
- **Server-side PDF or image rendering** — requires the network, which a receipt must never wait for.
- **Handlebars or other code-capable templates** — tenant-editable templates must not run code.
- **WebUSB or WebBluetooth printing from the browser** — unsupported on Safari and fragile elsewhere.
