import { readLocalStoreProfile } from "@mustawfi/core-organization/client";
import { priceCurrency } from "@mustawfi/inventory/client";
import { type DigitShape, formatDecimal, LOCALE, useDigitShape } from "@mustawfi/i18n";
import { Decimal, Money } from "@mustawfi/kernel";
import { type LocalExecutor, localOrm, useLocalDb } from "@mustawfi/local-db";
import { useCurrencyLabel } from "@mustawfi/ui";
import { asc, eq } from "drizzle-orm";
import { useTranslation } from "react-i18next";
import { BUSINESS_TIME_ZONE, localInvoiceLines, localInvoices } from "./local-sales.ts";
import { SALES_NAMESPACE } from "./messages.ts";
import { cashReceiptTemplate } from "./receipt-templates.ts";

/** One recorded invoice as its receipt shows it: exact values, not yet formatted. */
export interface ReceiptInvoice {
  readonly number: string;
  readonly soldAt: string;
  readonly templateVersion: string;
  readonly total: Money;
  readonly lines: readonly {
    readonly name: string;
    readonly quantity: Decimal;
    readonly unitPrice: Money;
    readonly amount: Money;
  }[];
}

const QUANTITY_SCALE = 4;
const PRICE_SCALE = 6;
const AMOUNT_SCALE = 4;

/** Reads an invoice this device recorded, with its lines in order, for its receipt. */
export async function readReceiptInvoice(
  executor: LocalExecutor,
  invoiceId: string,
): Promise<ReceiptInvoice | undefined> {
  const orm = localOrm(executor);
  const [invoice] = await orm.select().from(localInvoices).where(eq(localInvoices.id, invoiceId));
  if (invoice === undefined) return undefined;
  const currency = priceCurrency(invoice.currency);
  const money = (scaled: bigint, scale: number) =>
    Decimal.fromScaledInteger(scaled, scale).toString();
  const lines = await orm
    .select()
    .from(localInvoiceLines)
    .where(eq(localInvoiceLines.invoiceId, invoiceId))
    .orderBy(asc(localInvoiceLines.lineNo));
  return {
    number: invoice.number,
    soldAt: invoice.soldAt,
    templateVersion: invoice.templateVersion,
    total: Money.of(money(invoice.totalScaled, AMOUNT_SCALE), currency),
    lines: lines.map((line) => ({
      name: line.productName,
      quantity: Decimal.fromScaledInteger(line.quantityScaled, QUANTITY_SCALE),
      unitPrice: Money.of(money(line.unitPriceScaled, PRICE_SCALE), currency),
      amount: Money.of(money(line.amountScaled, AMOUNT_SCALE), currency),
    })),
  };
}

/** What a print pipeline needs: the template the invoice records, and its data. */
export interface ReceiptDocument {
  readonly template: string;
  readonly templateVersion: string;
  readonly data: object;
  /** The spooler's job name. */
  readonly documentName: string;
}

export interface ReceiptFormat {
  /** The store's name from its profile; empty until the profile reaches the device. */
  readonly storeName: string;
  readonly label: (key: string) => string;
  readonly currencyLabel: (code: string) => string;
  readonly digits: DigitShape;
  readonly deviceName: string;
}

/** The sale's time on the store's clock, `yyyy-mm-dd hh:mm`. */
function formatSoldAt(soldAt: string, digits: DigitShape): string {
  const parts = new Intl.DateTimeFormat(`${LOCALE}-u-nu-${digits}`, {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(soldAt));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

/**
 * Formats an invoice for the receipt template it recorded (non-negotiable 7), so a reprint
 * keeps the first print's layout; the store's name is the profile's current one. Refuses an
 * invoice recorded with a template version this client does not have, rather than printing it
 * with another one.
 */
export function receiptDocument(invoice: ReceiptInvoice, format: ReceiptFormat): ReceiptDocument {
  const template = cashReceiptTemplate(invoice.templateVersion);
  if (template === undefined) {
    throw new Error(`no receipt template ${invoice.templateVersion} on this client`);
  }
  const amount = (value: Money) =>
    formatDecimal(value.amount.toString(), {
      digits: format.digits,
      minimumFractionDigits: value.currency.minorUnits,
    });
  const labels = Object.fromEntries(
    [
      "title",
      "number",
      "date",
      "device",
      "item",
      "quantity",
      "price",
      "amount",
      "total",
      "thanks",
    ].map((key) => [key, format.label(key)]),
  );
  return {
    template: template.source,
    templateVersion: template.version,
    documentName: invoice.number,
    data: {
      store: { name: format.storeName },
      labels,
      invoice: {
        number: invoice.number,
        soldAt: formatSoldAt(invoice.soldAt, format.digits),
        device: format.deviceName,
        total: amount(invoice.total),
        currency: format.currencyLabel(invoice.total.currency.code),
      },
      lines: invoice.lines.map((line) => ({
        name: line.name,
        quantity: formatDecimal(line.quantity.toString(), { digits: format.digits }),
        unitPrice: amount(line.unitPrice),
        amount: amount(line.amount),
      })),
    },
  };
}

/** Builds the receipt of an invoice this device recorded, in the user's language and digits. */
export function useReceiptDocument(): (
  invoiceId: string,
  deviceName: string,
) => Promise<ReceiptDocument> {
  const { t } = useTranslation(SALES_NAMESPACE);
  const db = useLocalDb();
  const digits = useDigitShape();
  const currencyLabel = useCurrencyLabel();
  return async (invoiceId, deviceName) => {
    const invoice = await readReceiptInvoice(db, invoiceId);
    if (invoice === undefined) throw new Error(`no local invoice ${invoiceId}`);
    const profile = await readLocalStoreProfile(db);
    return receiptDocument(invoice, {
      storeName: profile?.name ?? "",
      label: (key) => t(`receipt.${key}`),
      currencyLabel,
      digits,
      deviceName,
    });
  };
}
