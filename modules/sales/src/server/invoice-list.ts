import { journalEntriesForSources } from "@mustawfi/core-ledger/server";
import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import { Decimal } from "@mustawfi/kernel";
import { desc, inArray } from "drizzle-orm";
import { type InvoiceFlagCode, invoiceFlagCodeSchema, type InvoiceView } from "../shared/index.ts";
import { INVOICE_SOURCE_TYPE } from "./invoices.ts";
import { invoiceFlags, invoices } from "./schema.ts";

/**
 * The tenant's newest invoices in `tx`, as the server recorded them, each with its flags and
 * the journal entry it posted (flow 7: the owner sees the sale and its entry).
 */
export async function listInvoices(
  tx: TenantTransaction,
  query: { readonly limit: number },
): Promise<InvoiceView[]> {
  const rows = await tx
    .select()
    .from(invoices)
    .orderBy(desc(invoices.createdAt), desc(invoices.id))
    .limit(query.limit);
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return [];
  const flags = new Map<string, InvoiceFlagCode[]>();
  for (const flag of await tx
    .select({ invoiceId: invoiceFlags.invoiceId, code: invoiceFlags.code })
    .from(invoiceFlags)
    .where(inArray(invoiceFlags.invoiceId, ids))
    .orderBy(invoiceFlags.code)) {
    flags.set(flag.invoiceId, [
      ...(flags.get(flag.invoiceId) ?? []),
      invoiceFlagCodeSchema.parse(flag.code),
    ]);
  }
  const entries = new Map(
    (await journalEntriesForSources(tx, INVOICE_SOURCE_TYPE, ids)).map((entry) => [
      entry.source.id,
      entry,
    ]),
  );
  return rows.map((row) => {
    const entry = entries.get(row.id);
    return {
      id: row.id,
      number: row.number,
      businessDate: row.businessDate,
      soldAt: row.soldAt.toISOString(),
      deviceId: row.deviceId,
      total: { amount: Decimal.of(row.total).toString(), currency: row.currency },
      flags: flags.get(row.id) ?? [],
      journalEntry:
        entry === undefined
          ? null
          : {
              id: entry.id,
              accountingDate: entry.accountingDate,
              currency: entry.currency,
              lines: entry.lines.map((line) => ({
                accountCode: line.accountCode,
                accountName: line.accountName,
                debit: line.debit,
                credit: line.credit,
              })),
            },
    };
  });
}
