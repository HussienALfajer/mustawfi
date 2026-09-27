import { Currency, Decimal, Money } from "@mustawfi/kernel";
import { renderTemplate } from "@mustawfi/printing";
import {
  type ReceiptFormat,
  type ReceiptInvoice,
  receiptDocument,
  type ReceiptStore,
} from "@mustawfi/sales/client";
import { describe, expect, it } from "vitest";

const SYP = Currency.of("SYP", 2);

const invoice: ReceiptInvoice = {
  number: "K7-INV-000001",
  soldAt: "2026-09-25T09:30:00.000Z",
  templateVersion: "receipt.cash.3",
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

const store: ReceiptStore = {
  name: "موبايلات <الحلبي>",
  address: "",
  phones: [],
  taxNumber: "",
  commercialRegister: "",
  logo: null,
};

const format: ReceiptFormat = {
  store,
  label: (key) => `«${key}»`,
  currencyLabel: (code) => code,
  digits: "latn",
  deviceName: "الصندوق",
};

const LOGO = { src: "data:image/png;base64,iVBORw0KGgo=", width: 160, height: 80 };

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
    const rendered = html(invoice, { ...format, store: { ...store, name: "" } });
    expect(rendered).not.toContain('class="store"');
    expect(rendered).not.toContain("<img");
    expect(rendered).toContain("<h1>«title»</h1>");
  });

  it("prints the logo at its size in dots above the name, then the store's details", () => {
    const rendered = html(invoice, {
      ...format,
      store: {
        ...store,
        address: "دمشق، الحميدية",
        phones: ["+963 944 123 456", "+963 11 222 3344"],
        taxNumber: "123456",
        commercialRegister: "7788",
        logo: LOGO,
      },
    });
    expect(rendered).toContain(
      `<div class="logo"><img src="${LOGO.src}" width="160" height="80" alt=""></div>`,
    );
    expect(rendered.indexOf('class="logo"')).toBeLessThan(rendered.indexOf('class="store"'));
    expect(rendered).toContain('<div class="contact">دمشق، الحميدية</div>');
    expect(rendered).toContain(
      '<span class="num">+963 944 123 456</span><span class="num">+963 11 222 3344</span>',
    );
    expect(rendered).toContain('«taxNumber» <span class="num">123456</span>');
    expect(rendered).toContain('«commercialRegister» <span class="num">7788</span>');
  });

  it("leaves out each detail the profile leaves empty", () => {
    const rendered = html(invoice);
    for (const part of ['class="logo"', 'class="contact', "«taxNumber»", "«commercialRegister»"]) {
      expect(rendered).not.toContain(part);
    }
  });

  it("reprints an invoice recorded before the logo with its own template, without it", () => {
    const withLogo = { ...format, store: { ...store, logo: LOGO } };
    const rendered = html({ ...invoice, templateVersion: "receipt.cash.2" }, withLogo);
    expect(rendered).not.toContain("<img");
    expect(rendered).toContain('<div class="store">موبايلات &lt;الحلبي&gt;</div>');
  });

  it("reprints an invoice recorded with the skeleton's template without the store's name", () => {
    const rendered = html({ ...invoice, templateVersion: "receipt.skeleton.1" });
    expect(rendered).not.toContain("الحلبي");
    expect(rendered).toContain("K7-INV-000001");
  });
});
