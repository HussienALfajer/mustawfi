import { syncIdSchema } from "@mustawfi/core-sync/shared";
import { decimalString } from "@mustawfi/kernel";
import { z } from "zod";

/** The document code in a sales invoice's number (ADR-0020). */
export const INVOICE_DOC_CODE = "INV";

const INVOICE_NUMBER = /^([A-HJ-NP-Z2-9]{2})-INV-(\d{6,15})$/;

/**
 * A sales invoice number, `{prefix}-INV-{seq:6}` (ADR-0020): the device's prefix and its
 * invoice sequence, zero-padded to six digits and longer beyond 999999.
 */
export function formatInvoiceNumber(prefix: string, seq: number): string {
  if (!/^[A-HJ-NP-Z2-9]{2}$/.test(prefix))
    throw new TypeError(`"${prefix}" is not a device prefix`);
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new RangeError(`an invoice sequence is a positive integer, got ${String(seq)}`);
  }
  return `${prefix}-${INVOICE_DOC_CODE}-${String(seq).padStart(6, "0")}`;
}

/** The prefix and sequence of a number in its one canonical form, or `undefined`. */
export function parseInvoiceNumber(number: string): { prefix: string; seq: number } | undefined {
  const match = INVOICE_NUMBER.exec(number);
  if (match === null) return undefined;
  const [, prefix = "", digits = ""] = match;
  const seq = Number.parseInt(digits, 10);
  return seq >= 1 && formatInvoiceNumber(prefix, seq) === number ? { prefix, seq } : undefined;
}

/**
 * What every skeleton document records for the fields of non-negotiable 7 that have no module
 * yet: departments (`core.organization`), shifts (`treasury`), and print templates. The units
 * that bring them replace these.
 */
export const SKELETON_DOCUMENT_DEFAULTS = {
  departmentId: "00000000-0000-7000-8000-000000000001",
  shiftId: "00000000-0000-7000-8000-000000000002",
  templateVersion: "receipt.skeleton.1",
} as const;

/** The sync operation that records a completed sale (ADR-0020). */
export const INVOICE_POST_OPERATION = "sales.invoice.post";

export const invoiceLinePayloadSchema = z.object({
  id: syncIdSchema,
  productId: syncIdSchema,
  quantity: decimalString({ scale: 4, sign: "positive" }),
  /** In the invoice's currency. */
  unitPrice: decimalString({ scale: 6, sign: "nonNegative" }),
  /** What the line came to on the device, in the invoice's currency. */
  amount: decimalString({ scale: 4, sign: "nonNegative" }),
});

/**
 * Payload version 1 of `sales.invoice.post`: the complete cash invoice as the device recorded
 * it (ADR-0020). The operation carries the user and the shift.
 */
export const invoicePostPayloadV1Schema = z.object({
  id: syncIdSchema,
  number: z.string().max(40),
  /** The device's day at the moment of the sale. */
  businessDate: z.iso.date(),
  currency: z.string().regex(/^[A-Z]{3}$/, "a currency is an ISO 4217 code"),
  /** Of `currency` to the base currency; `"1"` while the skeleton sells in the base currency. */
  exchangeRate: decimalString({ scale: 6, sign: "positive" }),
  departmentId: syncIdSchema,
  templateVersion: z.string().min(1).max(64),
  /** What the customer paid. */
  total: decimalString({ scale: 4, sign: "nonNegative" }),
  lines: z.array(invoiceLinePayloadSchema).min(1).max(500),
});

export type InvoicePostPayloadV1 = z.input<typeof invoicePostPayloadV1Schema>;

/**
 * What the server flags on an accepted invoice for the accountant (ADR-0020): recorded as the
 * device sent it, never refused. `negativeStock`: a product's stock went below zero.
 * `arithmeticMismatch`: a line is not its quantity times its price, or the lines do not add up
 * to the total.
 */
export const invoiceFlagCodeSchema = z.enum(["negativeStock", "arithmeticMismatch"]);
export type InvoiceFlagCode = z.infer<typeof invoiceFlagCodeSchema>;

/** The rejections of `sales.invoice.post`: invoices that cannot be recorded. */
export const salesProblemCodes = {
  /** The payload is malformed, or the total is finer than the currency's minor unit. */
  invoiceInvalid: "sales.invoice.invalid",
  /** The number is not `{prefix}-INV-{seq:6}` with the device's own prefix. */
  numberMismatch: "sales.invoice.numberMismatch",
  /** Not in the base currency at rate 1: multi-currency sales come with `core-money`. */
  unsupportedCurrency: "sales.invoice.unsupportedCurrency",
  /** A line names a product the store does not have. */
  unknownProduct: "sales.invoice.unknownProduct",
  /** Another operation already recorded this invoice id, number, or line id. */
  duplicate: "sales.invoice.duplicate",
} as const;

/** `GET /api/v1/sales/invoices?limit=`: the newest invoices first. */
export const invoiceListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const invoiceJournalLineSchema = z.object({
  accountCode: z.string(),
  accountName: z.string(),
  debit: decimalString({ scale: 4, sign: "nonNegative" }),
  credit: decimalString({ scale: 4, sign: "nonNegative" }),
});

/** An invoice as the server recorded it, with its flags and the journal entry it posted. */
export const invoiceViewSchema = z.object({
  id: syncIdSchema,
  number: z.string(),
  businessDate: z.iso.date(),
  /** The device's clock at the sale. */
  soldAt: z.iso.datetime({ offset: true }),
  deviceId: syncIdSchema,
  total: z.object({
    amount: decimalString({ scale: 4, sign: "nonNegative" }),
    currency: z.string(),
  }),
  flags: z.array(invoiceFlagCodeSchema),
  /** `null` for a free sale, which posts nothing. */
  journalEntry: z
    .object({
      id: syncIdSchema,
      accountingDate: z.iso.date(),
      currency: z.string(),
      lines: z.array(invoiceJournalLineSchema),
    })
    .nullable(),
});

export type InvoiceView = z.infer<typeof invoiceViewSchema>;

export const invoiceListSchema = z.object({ items: z.array(invoiceViewSchema) });
