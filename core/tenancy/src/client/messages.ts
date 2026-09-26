import type { Messages } from "@mustawfi/i18n";

/** The `tenancy` namespace (ADR-0023: one namespace per module, shipped in its client entry). */
export const TENANCY_NAMESPACE = "tenancy";

export const tenancyMessages = {
  /** Labels of this module's audit actions: `tenancy.license.installed` → `audit.license.installed`. */
  audit: {
    tenant: {
      created: "إنشاء المتجر",
    },
    license: {
      installed: "تثبيت ترخيص",
      readOnlyReached: "انتقال الجهاز إلى القراءة فقط لانتهاء الترخيص",
      suspendedReached: "إيقاف المتجر على الجهاز لانتهاء الترخيص",
      offlineTooLong: "تجاوز الجهاز أقصى مدة دون اتصال بالخادم",
    },
    clock: {
      movedBack: "إرجاع ساعة الجهاز إلى الوراء",
      wrong: "ساعة الجهاز بعيدة عن ساعة الخادم",
    },
  },
} satisfies Messages;
