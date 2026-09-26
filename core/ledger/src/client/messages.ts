import type { Messages } from "@mustawfi/i18n";

/** The `ledger` namespace (ADR-0023: one namespace per module, shipped in its client entry). */
export const LEDGER_NAMESPACE = "ledger";

export const ledgerMessages = {
  /** Labels of this module's audit actions: `ledger.accounts.seeded` → `audit.accounts.seeded`. */
  audit: {
    accounts: { seeded: "إنشاء دليل الحسابات الأساسي للمتجر" },
  },
} satisfies Messages;
