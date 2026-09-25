import type { Messages } from "@mustawfi/i18n";

/** The `tenancy` namespace (ADR-0023: one namespace per module, shipped in its client entry). */
export const TENANCY_NAMESPACE = "tenancy";

export const tenancyMessages = {
  /** Labels of this module's audit actions: `tenancy.license.installed` → `audit.license.installed`. */
  audit: {
    license: {
      installed: "تثبيت ترخيص",
    },
  },
} satisfies Messages;
