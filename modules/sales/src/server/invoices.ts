import { recordAudit } from "@mustawfi/core-audit/server";
import { postJournalEntry, systemAccounts } from "@mustawfi/core-ledger/server";
import {
  OperationRejected,
  type ReceivedOperation,
  type SyncHandlerDependencies,
  type SyncOperationDefinition,
} from "@mustawfi/core-sync/server";
import type { SyncValues } from "@mustawfi/core-sync/shared";
import { currentTenant, type TenantTransaction } from "@mustawfi/core-tenancy/server";
import { knownProducts, moveStock } from "@mustawfi/inventory/server";
import { Currency, Decimal, Money } from "@mustawfi/kernel";
import { z } from "zod";
import {
  INVOICE_POST_OPERATION,
  invoicePostPayloadV1Schema,
  parseInvoiceNumber,
  salesProblemCodes,
  type InvoiceFlagCode,
} from "../shared/index.ts";
import { invoiceFlags, invoiceLines, invoices } from "./schema.ts";

/** The document type journal entries and stock movements name an invoice by. */
export const INVOICE_SOURCE_TYPE = "sales.invoice";

/**
 * ISO 4217 minor units of the currencies the skeleton sells in, until `core.currency` owns
 * currency data (ADR-0007); a base currency missing here cannot be sold in.
 */
const MINOR_UNITS: Readonly<Record<string, number>> = { SYP: 2, USD: 2 };

/** The unique constraints another operation's invoice can collide with. */
const DUPLICATE_CONSTRAINTS = new Set([
  "invoices_pkey",
  "invoices_number_per_tenant",
  "invoices_doc_seq_per_device",
  "invoice_lines_pkey",
]);

/** The unique constraint a `23505` from the driver names, through its wrapping. */
function uniqueViolation(error: unknown): string | undefined {
  for (let e = error; e instanceof Error; e = e.cause) {
    const fields = e as { code?: unknown; constraint?: unknown };
    if (fields.code === "23505" && typeof fields.constraint === "string") return fields.constraint;
  }
  return undefined;
}

function reject(code: string, detail?: string): OperationRejected {
  return new OperationRejected(code, detail);
}

interface Flag {
  readonly code: InvoiceFlagCode;
  readonly detail: SyncValues;
}

/**
 * Records a completed cash sale (`sales.invoice.post`, payload version 1) in `tx`, the sync
 * operation's transaction (ADR-0020): the invoice and its lines as the device recorded them,
 * the stock movements, the flags for the accountant, the audit entry, and the balanced journal
 * entry — debit cash, credit sales revenue — all or nothing. A business rule never refuses it:
 * negative stock and arithmetic that does not add up are flagged. Only what cannot be recorded
 * is rejected.
 */
async function postInvoiceV1(
  tx: TenantTransaction,
  operation: ReceivedOperation,
  dependencies: SyncHandlerDependencies,
): Promise<SyncValues> {
  const parsed = invoicePostPayloadV1Schema.safeParse(operation.payload);
  if (!parsed.success) {
    throw reject(salesProblemCodes.invoiceInvalid, z.prettifyError(parsed.error));
  }
  const invoice = parsed.data;
  const number = parseInvoiceNumber(invoice.number);
  if (number?.prefix !== operation.device.prefix) {
    throw reject(
      salesProblemCodes.numberMismatch,
      `"${invoice.number}" is not {prefix}-INV-{seq:6} with prefix ${operation.device.prefix}`,
    );
  }
  const tenant = await currentTenant(tx);
  if (tenant === undefined) throw new Error("an operation outside a tenant");
  const minorUnits = MINOR_UNITS[invoice.currency];
  if (
    invoice.currency !== tenant.baseCurrency ||
    minorUnits === undefined ||
    !Decimal.of(invoice.exchangeRate).equals(Decimal.ONE)
  ) {
    throw reject(
      salesProblemCodes.unsupportedCurrency,
      `sold in ${invoice.currency} at ${invoice.exchangeRate}; the store sells in ${tenant.baseCurrency} at 1`,
    );
  }
  const currency = Currency.of(invoice.currency, minorUnits);
  const total = Money.of(invoice.total, currency);
  if (!total.isAtMinorUnit()) {
    throw reject(
      salesProblemCodes.invoiceInvalid,
      `the total is finer than ${currency.code}'s minor unit`,
    );
  }
  if (new Set(invoice.lines.map((line) => line.id)).size !== invoice.lines.length) {
    throw reject(salesProblemCodes.invoiceInvalid, "two lines share an id");
  }
  const known = await knownProducts(
    tx,
    invoice.lines.map((line) => line.productId),
  );
  const unknown = invoice.lines.find((line) => !known.has(line.productId));
  if (unknown !== undefined) {
    throw reject(
      salesProblemCodes.unknownProduct,
      `product ${unknown.productId} is not in the store`,
    );
  }

  const audit = {
    tenantId: operation.tenantId,
    branchId: operation.branchId,
    createdAt: operation.receivedAt,
    createdBy: operation.userId,
  };
  try {
    await tx.insert(invoices).values({
      ...audit,
      id: invoice.id,
      number: invoice.number,
      deviceId: operation.device.id,
      docSeq: number.seq,
      opId: operation.opId,
      businessDate: invoice.businessDate,
      soldAt: operation.createdAt,
      currency: invoice.currency,
      exchangeRate: invoice.exchangeRate,
      departmentId: invoice.departmentId,
      shiftId: operation.shiftId,
      templateVersion: invoice.templateVersion,
      total: invoice.total,
    });
    await tx.insert(invoiceLines).values(
      invoice.lines.map((line, index) => ({
        ...audit,
        id: line.id,
        invoiceId: invoice.id,
        lineNo: index + 1,
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        amount: line.amount,
      })),
    );
  } catch (error) {
    const constraint = uniqueViolation(error);
    if (constraint === undefined || !DUPLICATE_CONSTRAINTS.has(constraint)) throw error;
    throw reject(
      salesProblemCodes.duplicate,
      `invoice ${invoice.number} collides with a recorded one (${constraint})`,
    );
  }

  const flags: Flag[] = [];
  const levels = await moveStock(
    tx,
    {
      ...audit,
      source: { type: INVOICE_SOURCE_TYPE, id: invoice.id },
      movements: invoice.lines.map((line) => ({
        productId: line.productId,
        quantity: Decimal.of(line.quantity).negated(),
      })),
    },
    dependencies,
  );
  for (const level of levels) {
    if (level.onHand.isNegative()) {
      flags.push({
        code: "negativeStock",
        detail: { productId: level.productId, onHand: level.onHand.toString() },
      });
    }
  }

  // ADR-0018: a line is its quantity times its unit price, rounded half away from zero.
  const mismatchedLines = invoice.lines.flatMap((line, index) => {
    const expected = Money.of(line.unitPrice, currency)
      .times(Decimal.of(line.quantity))
      .roundToMinorUnit("halfAwayFromZero");
    return expected.equals(Money.of(line.amount, currency)) ? [] : [index + 1];
  });
  const linesTotal = Money.sum(
    invoice.lines.map((line) => Money.of(line.amount, currency)),
    currency,
  );
  if (mismatchedLines.length > 0 || !linesTotal.equals(total)) {
    flags.push({
      code: "arithmeticMismatch",
      detail: {
        lines: mismatchedLines,
        linesTotal: linesTotal.amount.toString(),
        total: total.amount.toString(),
      },
    });
  }
  if (flags.length > 0) {
    await tx.insert(invoiceFlags).values(
      flags.map((flag) => ({
        ...audit,
        id: dependencies.newId(),
        invoiceId: invoice.id,
        code: flag.code,
        detail: flag.detail,
      })),
    );
  }

  // The journal records what the customer paid. A free sale moves no money: nothing to post.
  let journalEntryId: string | null = null;
  if (total.isPositive()) {
    const { cash, salesRevenue } = await systemAccounts(tx);
    const posted = await postJournalEntry(
      tx,
      {
        id: dependencies.newId(),
        tenantId: operation.tenantId,
        branchId: operation.branchId,
        // No period locks yet: the entry counts on the day of the sale (ADR-0020).
        accountingDate: invoice.businessDate,
        postedAt: operation.receivedAt,
        postedBy: operation.userId,
        source: { type: INVOICE_SOURCE_TYPE, id: invoice.id },
        memo: invoice.number,
        lines: [
          { accountId: cash.id, side: "debit", amount: total, departmentId: invoice.departmentId },
          {
            accountId: salesRevenue.id,
            side: "credit",
            amount: total,
            departmentId: invoice.departmentId,
          },
        ],
      },
      dependencies,
    );
    journalEntryId = posted.id;
  }

  const flagCodes = flags.map((flag) => flag.code);
  await recordAudit(tx, {
    id: dependencies.newId(),
    tenantId: operation.tenantId,
    branchId: operation.branchId,
    occurredAt: operation.receivedAt,
    userId: operation.userId,
    deviceId: operation.device.id,
    action: "sales.invoice.created",
    entity: { type: INVOICE_SOURCE_TYPE, id: invoice.id },
    after: {
      number: invoice.number,
      total: { amount: total.amount.toString(), currency: currency.code },
      flags: flagCodes,
    },
  });
  return { invoiceId: invoice.id, number: invoice.number, journalEntryId, flags: flagCodes };
}

/** `sales.invoice.post`: a completed sale, pushed by the device that made it. */
export const invoicePostOperation: SyncOperationDefinition = {
  type: INVOICE_POST_OPERATION,
  versions: { 1: postInvoiceV1 },
};
