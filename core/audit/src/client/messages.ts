import type { Messages } from "@mustawfi/i18n";
import { auditLogMessages } from "./log/messages.ts";

/** The `audit` namespace (ADR-0023: one namespace per module, shipped in its client entry). */
export const AUDIT_NAMESPACE = "audit";

export const auditMessages = {
  /** The module's name over its permissions in the roles screen's matrix. */
  moduleName: "سجل التدقيق",
  /** Labels of this module's permissions: `audit.view` → `permission.view`. */
  permission: {
    view: "عرض سجل التدقيق",
  },
  log: auditLogMessages,
  /** The last line of every details panel (`screen-patterns.md`). */
  lastChange: {
    by: "آخر تعديل بواسطة {name} في {at}",
    at: "آخر تعديل في {at}",
    bySupport: "آخر تعديل بواسطة الدعم الفني لـ«فيرتكس» في {at}",
  },
} satisfies Messages;
