import { invoke } from "@tauri-apps/api/core";
import type { PrinterInfo, RawPrinterTransport } from "./transport.ts";

function toBase64(bytes: Uint8Array): string {
  let text = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    text += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(text);
}

/** The Windows shell's `printers` and `print_raw` commands (`apps/desktop/src-tauri`). */
export const tauriPrinterTransport: RawPrinterTransport = {
  listPrinters: () => invoke<PrinterInfo[]>("printers"),
  printRaw: (printer, documentName, bytes) =>
    invoke<number>("print_raw", { printer, document: documentName, bytes: toBase64(bytes) }),
};
