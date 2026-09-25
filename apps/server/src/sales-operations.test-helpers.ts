import { formatDocumentNumber } from "@mustawfi/core-organization/shared";
import type { SyncOperation } from "@mustawfi/core-sync/shared";
import { Currency, Decimal, Money, type IdGenerator } from "@mustawfi/kernel";
import {
  INVOICE_DOC_CODE,
  INVOICE_POST_OPERATION,
  SKELETON_DOCUMENT_DEFAULTS,
  type InvoicePostPayloadV1,
} from "@mustawfi/sales/shared";

const SYP = Currency.of("SYP", 2);

/** The receipt template version devices record today (`sales/client`'s current template). */
const RECEIPT_TEMPLATE_VERSION = "receipt.cash.2";

export interface InvoiceLineSpec {
  readonly productId: string;
  readonly quantity: string;
  readonly unitPrice: string;
  /** Defaults to quantity × unit price, rounded half away from zero. */
  readonly amount?: string;
}

export interface InvoiceOperationSpec {
  readonly newId: IdGenerator;
  readonly device: { readonly deviceId: string; readonly prefix: string };
  readonly userId: string;
  /** The department the invoice is sold under: the store's default one, as devices sell today. */
  readonly departmentId: string;
  readonly deviceSeq: number;
  /** The invoice's number sequence; defaults to `deviceSeq`. */
  readonly invoiceSeq?: number;
  readonly lines: readonly InvoiceLineSpec[];
  /** Defaults to the sum of the line amounts. */
  readonly total?: string;
  readonly createdAt?: Date;
  /** Replaces fields of the payload, for malformed and mismatched cases. */
  readonly payload?: Partial<Record<keyof InvoicePostPayloadV1, unknown>>;
  /** Replaces fields of the envelope. */
  readonly envelope?: Partial<SyncOperation>;
}

/** A `sales.invoice.post` operation, version 1, as a device's outbox would hold it. */
export function invoiceOperation(spec: InvoiceOperationSpec): SyncOperation {
  const lines = spec.lines.map((line) => ({
    id: spec.newId(),
    productId: line.productId,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    amount:
      line.amount ??
      Money.of(line.unitPrice, SYP)
        .times(Decimal.of(line.quantity))
        .roundToMinorUnit("halfAwayFromZero")
        .amount.toString(),
  }));
  const total =
    spec.total ??
    Money.sum(
      lines.map((line) => Money.of(line.amount, SYP)),
      SYP,
    ).amount.toString();
  const payload: InvoicePostPayloadV1 = {
    id: spec.newId(),
    number: formatDocumentNumber(
      spec.device.prefix,
      INVOICE_DOC_CODE,
      spec.invoiceSeq ?? spec.deviceSeq,
    ),
    businessDate: "2026-09-25",
    currency: "SYP",
    exchangeRate: "1",
    departmentId: spec.departmentId,
    templateVersion: RECEIPT_TEMPLATE_VERSION,
    total,
    lines,
  };
  return {
    opId: spec.newId(),
    deviceId: spec.device.deviceId,
    deviceSeq: spec.deviceSeq,
    type: INVOICE_POST_OPERATION,
    payloadVersion: 1,
    payload: { ...payload, ...spec.payload },
    userId: spec.userId,
    shiftId: SKELETON_DOCUMENT_DEFAULTS.shiftId,
    createdAt: (spec.createdAt ?? new Date("2026-09-25T09:30:00.000Z")).toISOString(),
    ...spec.envelope,
  };
}
