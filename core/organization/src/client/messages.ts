import type { Messages } from "@mustawfi/i18n";

/** The `organization` namespace (ADR-0023: one namespace per module, shipped in its client entry). */
export const ORGANIZATION_NAMESPACE = "organization";

export const organizationMessages = {
  /** Labels of this module's audit actions: `organization.department.created` → `audit.department.created`. */
  audit: {
    department: {
      created: "إضافة قسم",
      renamed: "إعادة تسمية قسم",
      archived: "أرشفة قسم",
    },
    profile: {
      created: "إنشاء ملف المتجر",
      changed: "تعديل ملف المتجر",
    },
  },
} satisfies Messages;
