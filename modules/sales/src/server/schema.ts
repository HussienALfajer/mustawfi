import type { SupervisorOverride } from "@mustawfi/core-access/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  jsonb,
  numeric,
  pgSchema,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * `sales` tables (ADR-0016, ADR-0020). Internal to the module: no entry exports them. An
 * invoice is posted when the server receives it, so invoices, their lines, and their flags are
 * immutable: `mustawfi_app` may only insert and read, and triggers refuse any change or
 * deletion by anyone (`0001_sales_rls.sql`). Corrections are returns and reversals.
 */
export const sales = pgSchema("sales");

/** A cash sales invoice, as the device recorded it (non-negotiable 7). */
export const invoices = sales.table(
  "invoices",
  {
    /** Generated on the device (ADR-0016). */
    id: uuid().primaryKey(),
    /** References `core_tenancy.tenants` (FK in `0001_sales_rls.sql`). */
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    /** When the server received it. */
    createdAt: timestamp({ withTimezone: true }).notNull(),
    /** The user who sold. */
    createdBy: uuid().notNull(),
    /** `{prefix}-INV-{seq:6}` (ADR-0020); unique within the tenant. */
    number: text().notNull(),
    /** The device that sold; references `core_access.devices` (FK in `0001_sales_rls.sql`). */
    deviceId: uuid().notNull(),
    /** The number's sequence: per device, gapless on the device. */
    docSeq: bigint({ mode: "number" }).notNull(),
    /** The sync operation that carried it. */
    opId: uuid().notNull().unique(),
    /** The device's day at the moment of the sale (ADR-0020). */
    businessDate: date().notNull(),
    /** The device's clock at the moment of the sale. */
    soldAt: timestamp({ withTimezone: true }).notNull(),
    currency: text().notNull(),
    /** Of `currency` to the base currency. */
    exchangeRate: numeric({ precision: 20, scale: 6 }).notNull(),
    /**
     * The profit center (ADR-0006); references `core_tenancy.departments`, tenant-scoped (FK in
     * `0002_invoices_department_fk.sql`).
     */
    departmentId: uuid().notNull(),
    /** References the `treasury` shift once it exists. */
    shiftId: uuid().notNull(),
    /** The print template version the receipt used. */
    templateVersion: text().notNull(),
    /** What the customer paid, in `currency`. */
    total: numeric({ precision: 20, scale: 4 }).notNull(),
    /**
     * The supervisor overrides the sale needed (`core-foundation` rule 18) — approver, override
     * id, action, department, value — as the device attached them: an immutable snapshot of the
     * payload. Whether each approver's role covers it is `core.sync`'s `overrideNotAuthorized`.
     */
    overrides: jsonb()
      .$type<readonly SupervisorOverride[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (t) => [
    unique("invoices_number_per_tenant").on(t.tenantId, t.number),
    unique("invoices_doc_seq_per_device").on(t.tenantId, t.deviceId, t.docSeq),
    // Target of the lines' and flags' tenant-scoped foreign keys.
    unique("invoices_id_per_tenant").on(t.tenantId, t.id),
    check("invoices_doc_seq_positive", sql`${t.docSeq} > 0`),
    check("invoices_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("invoices_exchange_rate_positive", sql`${t.exchangeRate} > 0`),
    check("invoices_total_not_negative", sql`${t.total} >= 0`),
    check("invoices_overrides_array", sql`jsonb_typeof(${t.overrides}) = 'array'`),
  ],
);

export const invoiceLines = sales.table(
  "invoice_lines",
  {
    /** Generated on the device. */
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    invoiceId: uuid().notNull(),
    /** Position in the invoice, from 1. */
    lineNo: smallint().notNull(),
    /** References `inventory.products`, tenant-scoped (FK in `0001_sales_rls.sql`). */
    productId: uuid().notNull(),
    quantity: numeric({ precision: 20, scale: 4 }).notNull(),
    /** In the invoice's currency. */
    unitPrice: numeric({ precision: 20, scale: 6 }).notNull(),
    /** As the device computed it, in the invoice's currency. */
    amount: numeric({ precision: 20, scale: 4 }).notNull(),
  },
  (t) => [
    unique("invoice_lines_line_no").on(t.invoiceId, t.lineNo),
    foreignKey({
      name: "invoice_lines_invoice_fk",
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    check("invoice_lines_line_no_positive", sql`${t.lineNo} > 0`),
    check("invoice_lines_quantity_positive", sql`${t.quantity} > 0`),
    check("invoice_lines_unit_price_not_negative", sql`${t.unitPrice} >= 0`),
    check("invoice_lines_amount_not_negative", sql`${t.amount} >= 0`),
  ],
);

/** What the accountant should review about an accepted invoice (ADR-0020). */
export const invoiceFlags = sales.table(
  "invoice_flags",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    invoiceId: uuid().notNull(),
    /** `negativeStock` or `arithmeticMismatch`. */
    code: text().notNull(),
    /** What was found, as a snapshot: the product and its stock, or the amounts. */
    detail: jsonb().$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    foreignKey({
      name: "invoice_flags_invoice_fk",
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    check("invoice_flags_code", sql`${t.code} in ('negativeStock', 'arithmeticMismatch')`),
  ],
);
