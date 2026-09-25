import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  numeric,
  pgSchema,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * `core_ledger` tables (ADR-0006, ADR-0016, ADR-0018). Internal to the module: no entry exports
 * them; other modules post through `postJournalEntry`. Every journal entry is posted when it is
 * written, so entries and lines are immutable: `mustawfi_app` may only insert and read, and
 * triggers refuse any change or deletion by anyone (`0001_ledger_rls.sql`). A deferred
 * constraint trigger refuses, at commit, an entry whose lines do not balance.
 */
export const coreLedger = pgSchema("core_ledger");

/** The tenant's chart of accounts; seeded from a template, editable later (ADR-0006). */
export const accounts = coreLedger.table(
  "accounts",
  {
    id: uuid().primaryKey(),
    /** References `core_tenancy.tenants` (FK in `0001_ledger_rls.sql`). */
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    /** The accountant's number for it (`1100`); unique within the tenant. */
    code: text().notNull(),
    name: text().notNull(),
    /** `asset`, `liability`, `equity`, `revenue`, or `expense`. */
    kind: text().notNull(),
    /** The role posting rules find it by (`cash`…), unique within the tenant; null for others. */
    systemKey: text(),
  },
  (t) => [
    unique("accounts_code_per_tenant").on(t.tenantId, t.code),
    unique("accounts_system_key_per_tenant").on(t.tenantId, t.systemKey),
    // Target of the lines' tenant-scoped foreign key.
    unique("accounts_id_per_tenant").on(t.tenantId, t.id),
    check(
      "accounts_kind",
      sql`${t.kind} in ('asset', 'liability', 'equity', 'revenue', 'expense')`,
    ),
    check(
      "accounts_system_key",
      sql`${t.systemKey} in ('cash', 'salesRevenue', 'roundingDifferences')`,
    ),
  ],
);

/** A posted journal entry: balanced in the base currency, never changed (non-negotiables 5, 6). */
export const journalEntries = coreLedger.table(
  "journal_entries",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    /** When it was posted. */
    createdAt: timestamp({ withTimezone: true }).notNull(),
    /** Who posted it: the user behind the document. */
    createdBy: uuid().notNull(),
    /** The day it counts in; period locks apply to it (non-negotiable 9, ADR-0020). */
    accountingDate: date().notNull(),
    /** The tenant's base currency, in which every line's debit and credit are. */
    currency: text().notNull(),
    /** The document it records (`sales.invoice` and its id). */
    sourceType: text().notNull(),
    sourceId: uuid().notNull(),
    memo: text(),
  },
  (t) => [
    unique("journal_entries_id_per_tenant").on(t.tenantId, t.id),
    check("journal_entries_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "journal_entries_source_type",
      sql`${t.sourceType} ~ '^[a-z][a-zA-Z0-9]*(\\.[a-z][a-zA-Z0-9]*)+$'`,
    ),
  ],
);

/** One side of an entry: a positive debit or a positive credit, in the base currency. */
export const journalLines = coreLedger.table(
  "journal_lines",
  {
    id: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().notNull(),
    journalEntryId: uuid().notNull(),
    /** Position in the entry, from 1. */
    lineNo: smallint().notNull(),
    accountId: uuid().notNull(),
    /** The profit center (ADR-0006); references `core.organization` once it exists. */
    departmentId: uuid().notNull(),
    /** The line's own currency; the base currency until multi-currency posting (`core-money`). */
    currency: text().notNull(),
    debit: numeric({ precision: 20, scale: 4 }).notNull(),
    credit: numeric({ precision: 20, scale: 4 }).notNull(),
  },
  (t) => [
    unique("journal_lines_line_no").on(t.journalEntryId, t.lineNo),
    // Tenant-scoped foreign keys: a line can reference only its own tenant's entry and account,
    // which a plain foreign key would not ensure (its check bypasses row-level security).
    foreignKey({
      name: "journal_lines_entry_fk",
      columns: [t.tenantId, t.journalEntryId],
      foreignColumns: [journalEntries.tenantId, journalEntries.id],
    }),
    foreignKey({
      name: "journal_lines_account_fk",
      columns: [t.tenantId, t.accountId],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
    check("journal_lines_line_no_positive", sql`${t.lineNo} > 0`),
    check("journal_lines_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "journal_lines_one_side",
      sql`(${t.debit} > 0 and ${t.credit} = 0) or (${t.credit} > 0 and ${t.debit} = 0)`,
    ),
  ],
);
