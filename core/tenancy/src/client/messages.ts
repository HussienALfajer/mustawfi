import type { Messages } from "@mustawfi/i18n";

/** The `tenancy` namespace (ADR-0023: one namespace per module, shipped in its client entry). */
export const TENANCY_NAMESPACE = "tenancy";

export const tenancyMessages = {
  /**
   * The audit log's names for this module's records (`auditEntity`), the fields of their
   * before and after snapshots (`auditField`), and coded values of those fields
   * (`auditValue`), so the log reads in words (`core-foundation` QA slice 26).
   */
  auditEntity: {
    license: "ترخيص",
    tenant: "المتجر",
  },
  auditField: {
    name: "الاسم",
    storeCode: "رمز المتجر",
    baseCurrency: "العملة الأساسية",
    defaultBranchId: "الفرع الافتراضي",
    defaultDepartmentId: "القسم الافتراضي",
    tenant: "المتجر",
    kid: "مفتاح التوقيع",
    plan: "الباقة",
    issuedAt: "أُصدر في",
    notBefore: "يسري من",
    expiresAt: "ينتهي في",
    graceDays: "أيام السماح",
    readOnlyDays: "أيام القراءة فقط",
    maxOfflineDays: "أقصى أيام دون اتصال",
    limits: "الحدود",
    users: "المستخدمون النشطون",
    departments: "الأقسام النشطة",
    mainPosDevices: "أجهزة البيع الرئيسية",
    companionDevices: "الأجهزة المساعدة",
    entitlements: "الوحدات المشمولة",
    state: "حالة الترخيص",
    businessDate: "يوم العمل",
    licenseIssuedAt: "إصدار الترخيص",
    lastServerContact: "آخر اتصال بالخادم",
    localTime: "ساعة الجهاز",
    highWaterMark: "أحدث وقت رآه الجهاز",
    serverTime: "ساعة الخادم",
  },
  auditValue: {
    state: {
      active: "ساري",
      expiring: "ينتهي قريبًا",
      grace: "مهلة سماح",
      readOnly: "قراءة فقط",
      suspended: "موقوف",
    },
  },
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
