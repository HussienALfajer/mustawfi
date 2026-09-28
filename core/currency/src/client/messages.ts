import type { Messages } from "@mustawfi/i18n";

/** The `currency` namespace (ADR-0023: one namespace per module, shipped in its client entry). */
export const CURRENCY_NAMESPACE = "currency";

export const currencyMessages = {
  /** The module's name over its permissions in the roles screen's matrix. */
  moduleName: "العملات",
  /** Labels of this module's permissions: `currency.rate.set` → `permission.rate.set`. */
  permission: {
    rate: { set: "تحديد سعر الصرف" },
  },
  /**
   * The audit log's names for this module's records (`auditEntity`) and the fields of their
   * snapshots (`auditField`), so the log reads in words (`core-foundation` QA slice 26).
   */
  auditEntity: {
    exchangeRate: "سعر صرف",
  },
  auditField: {
    currencies: "العملات",
    changeCurrency: "عملة الباقي",
    rateChangeThresholdPercent: "حد تأكيد تغيّر السعر (%)",
    unitCurrency: "العملة",
    quoteCurrency: "مقابل",
    rate: "السعر",
    effectiveAt: "ساري منذ",
    deviceEffectiveAt: "وقت الجهاز",
    confirmed: "مؤكَّد رغم تجاوز الحد",
    current: "أصبح السعر الحالي",
  },
  /** Labels of this module's audit actions: `currency.currencies.seeded` → `audit.currencies.seeded`. */
  audit: {
    currencies: { seeded: "إعداد عملات المتجر الأساسية" },
    rate: { set: "تحديد سعر الصرف" },
  },
} satisfies Messages;
