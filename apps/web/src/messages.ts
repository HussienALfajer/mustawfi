import type { Messages } from "@mustawfi/i18n";

/** The `shell` namespace: the app frame around module screens. */
export const SHELL_NAMESPACE = "shell";

export const shellMessages = {
  mark: "مستوفي",
  vendor: "من Vertex System",
  skipToContent: "انتقل إلى المحتوى",
  nav: {
    label: "الأقسام",
    products: "المنتجات",
  },
  signedInAs: "{name}",
  sessionFailed: "تعذّر التحقق من الجلسة. تحقّق من الاتصال ثم أعد تحميل الصفحة",
  notFound: "الصفحة غير موجودة",
  home: "العودة إلى المنتجات",
} satisfies Messages;
