import ReceiptPrinterEncoder from "@point-of-sale/receipt-printer-encoder";
import { DEFAULT_THRESHOLD, type Raster } from "./raster.ts";

export interface ReceiptCommands {
  /** Cut the paper after the receipt (partial cut, the usual for receipts). */
  readonly cut: boolean;
  /** Open the cash drawer on the printer's drawer port (`ESC p`), before printing. */
  readonly openDrawer: boolean;
}

/**
 * Encodes a receipt raster as ESC/POS (step 4 of ADR-0025): initialize, the drawer kick if
 * asked, the image as `GS v 0` raster commands of at most 255 rows, then feed and cut. The
 * raster is printed at one pixel per dot; its width must be a whole number of bytes.
 */
export function encodeReceipt(raster: Raster, commands: ReceiptCommands): Uint8Array {
  if (raster.width <= 0 || raster.width % 8 !== 0 || raster.height <= 0) {
    throw new Error(
      `a receipt raster must be a positive multiple of 8 dots wide (${raster.width})`,
    );
  }
  const encoder = new ReceiptPrinterEncoder({
    language: "esc-pos",
    imageMode: "raster",
    columns: raster.width / 12,
  });
  encoder.initialize();
  // The drawer opens while the receipt prints, not after it.
  if (commands.openDrawer) encoder.pulse();
  encoder.image(
    { width: raster.width, height: raster.height, data: raster.data },
    {
      width: raster.width,
      height: raster.height,
      algorithm: "threshold",
      threshold: DEFAULT_THRESHOLD,
    },
  );
  if (commands.cut) encoder.cut("partial");
  return encoder.encode();
}
