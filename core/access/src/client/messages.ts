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
  device: {
    title: "هذا الجهاز",
    loading: "جارٍ قراءة بيانات الجهاز…",
    localFailed: "تعذّر فتح قاعدة البيانات المحلية لهذا الجهاز",
    required: "هذا الحقل مطلوب",
    tooLong: "النص أطول من المسموح",
    unreachable: "تعذّر الوصول إلى الخادم. تسجيل الجهاز يحتاج اتصالًا؛ حاول مجددًا",
    refused: "رفض الخادم الطلب. حاول مجددًا",
    registrationFailed: "رمز المتجر أو رمز التسجيل غير صحيح أو مستخدم أو منتهي الصلاحية",
    alreadyRegistered: "هذا الجهاز مسجّل من قبل",
    issue: {
      title: "إصدار رمز تسجيل",
      help: "يصدره صاحب المتجر، ويصلح لجهاز واحد خلال خمس عشرة دقيقة",
      action: "إصدار رمز تسجيل",
      issued: "رمز التسجيل:",
    },
    register: {
      title: "تسجيل هذا الجهاز",
      help: "يبيع الجهاز المسجّل دون اتصال، ويرسل مبيعاته إلى الخادم عند عودة الاتصال",
      storeCode: "رمز المتجر",
      registrationCode: "رمز التسجيل",
      name: "اسم الجهاز",
      nameHelp: "مثل: الصندوق الرئيسي",
      submit: "تسجيل الجهاز",
    },
    registered: {
      name: "اسم الجهاز",
      prefix: "بادئة أرقام الفواتير",
      state: "الحالة",
      ready: "مسجّل وجاهز للبيع",
    },
  },
} satisfies Messages;
