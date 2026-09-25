import { Currency, Decimal, Money } from "@mustawfi/kernel";
import { renderTemplate } from "@mustawfi/printing";
import { type ReceiptFormat, type ReceiptInvoice, receiptDocument } from "@mustawfi/sales/client";
import { describe, expect, it } from "vitest";

const SYP = Currency.of("SYP", 2);

const invoice: ReceiptInvoice = {
  number: "K7-INV-000001",
  soldAt: "2026-09-25T09:30:00.000Z",
  templateVersion: "receipt.cash.2",
  total: Money.of("5", SYP),
  lines: [
    {
      name: "شاحن",
      quantity: Decimal.of("1"),
      unitPrice: Money.of("5", SYP),
      amount: Money.of("5", SYP),
    },
  ],
};

const format: ReceiptFormat = {
  storeName: "موبايلات <الحلبي>",
  label: (key) => `«${key}»`,
  currencyLabel: (code) => code,
  digits: "latn",
  deviceName: "الصندوق",
};

/** The HTML the print pipeline lays out for `invoice`, as `ReceiptActions` builds it. */
function html(receipt: ReceiptInvoice, receiptFormat: ReceiptFormat = format): string {
  const document = receiptDocument(receipt, receiptFormat);
  return renderTemplate(document.template, document.data);
}

describe("the cash receipt, rendered", () => {
  it("is headed by the store's name, escaped like every other value", () => {
    expect(html(invoice)).toContain(
      '<div class="store">موبايلات &lt;الحلبي&gt;</div>\n  <h1>«title»</h1>',
    );
  });

  it("leaves the heading out while the store's profile has not reached the device", () => {
    const rendered = html(invoice, { ...format, storeName: "" });
    expect(rendered).not.toContain('class="store"');
    expect(rendered).toContain("<h1>«title»</h1>");
  });

  it("reprints an invoice recorded with the skeleton's template without the store's name", () => {
    const rendered = html({ ...invoice, templateVersion: "receipt.skeleton.1" });
    expect(rendered).not.toContain("الحلبي");
    expect(rendered).toContain("K7-INV-000001");
  });
});
