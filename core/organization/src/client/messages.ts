import type { Messages } from "@mustawfi/i18n";
import { departmentsMessages } from "./departments/messages.ts";
import { licenseMessages } from "./license/messages.ts";
import { storeProfileMessages } from "./store-profile/messages.ts";

/** The `organization` namespace (ADR-0023: one namespace per module, shipped in its client entry). */
export const ORGANIZATION_NAMESPACE = "organization";

export const organizationMessages = {
  /** The module's name over its permissions in the roles screen's matrix. */
  moduleName: "المتجر والأقسام",
  /** Labels of this module's permissions: `organization.profile.edit` → `permission.profile.edit`. */
  permission: {
    profile: { edit: "تعديل بيانات المتجر" },
    departments: { manage: "إدارة الأقسام" },
    license: { view: "عرض الترخيص والباقة" },
  },
  /**
   * The audit log's names for this module's records (`auditEntity`), the fields of their
   * before and after snapshots (`auditField`), and coded values of those fields
   * (`auditValue`), so the log reads in words (`core-foundation` QA slice 26).
   */
  auditEntity: {
    department: "قسم",
    storeProfile: "بيانات المتجر",
  },
  auditField: {
    id: "المعرّف",
    name: "الاسم",
    isDefault: "القسم الافتراضي",
    sortOrder: "الترتيب",
    archivedAt: "وقت الأرشفة",
    usersInScope: "المستخدمون الذين عاد إلى أقسامهم",
    address: "العنوان",
    phones: "الهواتف",
    unreadablePhones: "هواتف لم تُقرأ",
    taxNumber: "الرقم الضريبي",
    commercialRegister: "السجل التجاري",
    logo: "الشعار",
    logoPrint: "طباعة الشعار",
    updatedAt: "آخر تحديث",
    docCode: "رمز المستند",
    first: "أول رقم ناقص",
    last: "آخر رقم ناقص",
    count: "عدد الأرقام الناقصة",
    number: "الرقم الذي كشفها",
  },
  auditValue: {
    logoPrint: {
      threshold: "شعار خطّي",
      dither: "صورة",
    },
    isDefault: {
      true: "نعم",
      false: "لا",
    },
  },
  /** Labels of this module's audit actions: `organization.department.created` → `audit.department.created`. */
  audit: {
    department: {
      created: "إضافة قسم",
      renamed: "إعادة تسمية قسم",
      archived: "أرشفة قسم",
      restored: "استعادة قسم مؤرشف",
    },
    profile: {
      created: "إنشاء بيانات المتجر",
      changed: "تعديل بيانات المتجر",
    },
    numbering: {
      gap: "أرقام مستندات ناقصة",
    },
  },
  departments: departmentsMessages,
  profile: storeProfileMessages,
  license: licenseMessages,
} satisfies Messages;
