import type { Messages } from "@mustawfi/i18n";

/** The `sync` namespace (ADR-0023: one namespace per module, shipped in its client entry). */
export const SYNC_NAMESPACE = "sync";

export const syncMessages = {
  status: {
    label: "حالة المزامنة",
    unregistered: "الجهاز غير مسجّل",
    idle: "متزامن",
    syncing: "جارٍ المزامنة…",
    offline: "غير متصل",
    failed: "تعذّرت المزامنة",
    revoked: "أُبطل الجهاز — يُرسل ما تبقّى",
    removed: "أُزيل الجهاز من المتجر",
    pending:
      "{count, plural, zero {لا عمليات بانتظار الإرسال} one {عملية واحدة بانتظار الإرسال} two {عمليتان بانتظار الإرسال} few {# عمليات بانتظار الإرسال} many {# عملية بانتظار الإرسال} other {# عملية بانتظار الإرسال}}",
    needsReview:
      "{count, plural, one {عملية واحدة رُفضت وتحتاج مراجعة} two {عمليتان رُفضتا وتحتاجان مراجعة} few {# عمليات رُفضت وتحتاج مراجعة} many {# عملية رُفضت وتحتاج مراجعة} other {# عملية رُفضت وتحتاج مراجعة}}",
    syncNow: "مزامنة الآن",
  },
} satisfies Messages;
