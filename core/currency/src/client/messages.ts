import type { Messages } from "@mustawfi/i18n";

/** The `currency` namespace (ADR-0023: one namespace per module, shipped in its client entry). */
export const CURRENCY_NAMESPACE = "currency";

export const currencyMessages = {
  /**
   * The audit log's names for the fields of this module's snapshots (`auditField`), so the log
   * reads in words (`core-foundation` QA slice 26).
   */
  auditField: {
    currencies: "العملات",
    changeCurrency: "عملة الباقي",
    rateChangeThresholdPercent: "حد تأكيد تغيّر السعر (%)",
  },
  /** Labels of this module's audit actions: `currency.currencies.seeded` → `audit.currencies.seeded`. */
  audit: {
    currencies: { seeded: "إعداد عملات المتجر الأساسية" },
  },
} satisfies Messages;
