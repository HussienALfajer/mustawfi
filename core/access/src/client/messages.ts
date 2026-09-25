import type { Messages } from "@mustawfi/i18n";

/** The `access` namespace (ADR-0023: one namespace per module, shipped in its client entry). */
export const ACCESS_NAMESPACE = "access";

export const accessMessages = {
  login: {
    title: "تسجيل الدخول",
    storeCode: "رمز المتجر",
    storeCodeHelp: "ستة أحرف وأرقام، تجده عند صاحب المتجر",
    login: "اسم الدخول",
    password: "كلمة المرور",
    submit: "دخول",
    submitting: "جارٍ الدخول…",
    required: "هذا الحقل مطلوب",
    failed: "رمز المتجر أو اسم الدخول أو كلمة المرور غير صحيح",
    unreachable: "تعذّر الوصول إلى الخادم. تحقّق من الاتصال ثم حاول مجددًا",
    refused: "رُفض الطلب. أعد تحميل الصفحة ثم حاول مجددًا",
  },
  signOut: {
    action: "تسجيل الخروج",
    failed: "تعذّر تسجيل الخروج. حاول مجددًا",
  },
} satisfies Messages;
