import type { Messages } from "@mustawfi/i18n";

/** The `ledger` namespace (ADR-0023: one namespace per module, shipped in its client entry). */
export const LEDGER_NAMESPACE = "ledger";

export const ledgerMessages = {
  /**
   * The audit log's names for this module's records (`auditEntity`), the fields of their
   * before and after snapshots (`auditField`), and coded values of those fields
   * (`auditValue`), so the log reads in words (`core-foundation` QA slice 26).
   */
  auditField: {
    accounts: "الحسابات",
  },
  /** Labels of this module's audit actions: `ledger.accounts.seeded` → `audit.accounts.seeded`. */
  audit: {
    accounts: { seeded: "إنشاء دليل الحسابات الأساسي للمتجر" },
  },
} satisfies Messages;
