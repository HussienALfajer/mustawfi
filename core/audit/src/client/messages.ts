import type { Messages } from "@mustawfi/i18n";

/** The `audit` namespace (ADR-0023: one namespace per module, shipped in its client entry). */
export const AUDIT_NAMESPACE = "audit";

export const auditMessages = {
  /** The module's name over its permissions in the roles screen's matrix. */
  moduleName: "سجل التدقيق",
  /** Labels of this module's permissions: `audit.view` → `permission.view`. */
  permission: {
    view: "عرض سجل التدقيق",
  },
} satisfies Messages;
