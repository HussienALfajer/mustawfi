import { z } from "zod";

/** Where an account sits in the statements; its normal balance follows from it. */
export const accountKindSchema = z.enum(["asset", "liability", "equity", "revenue", "expense"]);
export type AccountKind = z.infer<typeof accountKindSchema>;

/**
 * The accounts posting rules find by role rather than by code, which the tenant may change:
 * cash, sales revenue, and rounding differences (ADR-0018). Seeded with every tenant.
 */
export const systemAccountKeySchema = z.enum(["cash", "salesRevenue", "roundingDifferences"]);
export type SystemAccountKey = z.infer<typeof systemAccountKeySchema>;

export const journalSideSchema = z.enum(["debit", "credit"]);
export type JournalSide = z.infer<typeof journalSideSchema>;

/** A calendar day, `YYYY-MM-DD` — the accounting date of an entry (ADR-0016). */
export const calendarDateSchema = z.iso.date();

/** The refusals of `postJournalEntry`; each one is a defect of the caller's posting rule. */
export const ledgerProblemCodes = {
  /** Debits and credits differ in the base currency. */
  entryUnbalanced: "ledger.entry.unbalanced",
  /**
   * Fewer than two lines, an amount that is not positive or not at the currency's minor unit,
   * a line not in the base currency, an unknown account, or a malformed date.
   */
  entryInvalid: "ledger.entry.invalid",
} as const;
