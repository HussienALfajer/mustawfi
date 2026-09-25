import type { ReceiptCommands } from "@mustawfi/printing";

/**
 * What one print of a receipt asks of the printer. The drawer opens only with the sale: on the
 * first print of the receipt the sale itself offers, never on a reprint — an opening without a
 * sale is an audited event (non-negotiable 10), and the client has no audit path for it yet.
 */
export function receiptCommands(
  settings: { readonly cut: boolean; readonly openDrawer: boolean },
  print: { readonly justSold: boolean; readonly drawerAlreadyOpened: boolean },
): ReceiptCommands {
  return {
    cut: settings.cut,
    openDrawer: settings.openDrawer && print.justSold && !print.drawerAlreadyOpened,
  };
}
