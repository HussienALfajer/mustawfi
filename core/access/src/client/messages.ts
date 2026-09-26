import type { Messages } from "@mustawfi/i18n";
import { accountMessages } from "./account/messages.ts";
import { devicesMessages } from "./devices/messages.ts";
import { rolesMessages } from "./roles/messages.ts";
import { usersMessages } from "./users/messages.ts";

/** The `access` namespace (ADR-0023: one namespace per module, shipped in its client entry). */
export const ACCESS_NAMESPACE = "access";

export const accessMessages = {
  /** The module's name over its permissions in the roles screen's matrix. */
  moduleName: "المستخدمون والأجهزة",
  /** Labels of this module's permissions: `access.users.view` → `permission.users.view`. */
  permission: {
    users: {
      view: "عرض المستخدمين والأدوار",
      manage: "إضافة المستخدمين وتعديلهم وإيقافهم",
      unlock: "فك قفل مستخدم على الجهاز",
    },
    roles: { manage: "إدارة الأدوار والصلاحيات" },
    devices: { manage: "إدارة الأجهزة" },
  },
  /** Labels of this module's audit actions: `access.role.created` → `audit.role.created`. */
  audit: {
    role: {
      created: "إنشاء دور",
      changed: "تعديل دور",
      archived: "أرشفة دور",
    },
    user: {
      created: "إنشاء مستخدم",
      changed: "تعديل اسم مستخدم أو اسم دخوله",
      roleChanged: "تغيير دور مستخدم",
      scopeChanged: "تغيير أقسام مستخدم",
      deactivated: "إيقاف مستخدم",
      reactivated: "إعادة تفعيل مستخدم",
      pinSet: "تعيين الرمز السري لمستخدم",
      passwordSet: "تعيين كلمة مرور مستخدم",
      pinChanged: "تغيير المستخدم رمزه السري",
      passwordChanged: "تغيير المستخدم كلمة مروره",
      passwordReset: "تعيين كلمة مرور المالك برمز استعادة من الدعم الفني",
    },
    login: {
      throttled: "إيقاف محاولات الدخول مؤقتًا بعد محاولات فاشلة كثيرة",
    },
    twoFactor: {
      enabled: "تفعيل المستخدم التحقق بخطوتين",
      disabled: "إيقاف المستخدم التحقق بخطوتين",
      cleared: "إلغاء التحقق بخطوتين لمستخدم (من المالك أو باستعادة الدعم الفني)",
      recoveryCodeUsed: "الدخول برمز استرداد للتحقق بخطوتين",
    },
    resetCode: {
      issued: "إصدار الدعم الفني رمز استعادة لكلمة مرور المالك",
    },
    device: {
      revoked: "إبطال جهاز",
      wiped: "مسح الجهاز المُبطَل بياناته",
    },
  },
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
    throttled: "محاولات فاشلة كثيرة. انتظر ربع ساعة ثم حاول مجددًا",
    deviceRequired: "لم يعد هذا الجهاز معروفًا لدى المتجر. سجّله من جديد أو ادخل من متصفح آخر",
    deviceRevoked:
      "أُزيل هذا الجهاز من المتجر. ادخل من جهاز آخر، أو اطلب من صاحب المتجر تسجيله من جديد",
    unreachable: "تعذّر الوصول إلى الخادم. تحقّق من الاتصال ثم حاول مجددًا",
    suspended:
      "ترخيص المتجر موقوف، فلا يدخل إلا المالكون حتى يُجدَّد. اطلب من صاحب المتجر تجديد الترخيص",
    refused: "رُفض الطلب. أعد تحميل الصفحة ثم حاول مجددًا",
    passwordWasReset: "عُيّنت كلمة المرور الجديدة. ادخل بها الآن",
    forgot: "نسيت كلمة المرور؟ ادخل برمز من الدعم الفني",
    secondFactor: {
      title: "التحقق بخطوتين",
      help: "حسابك محمي بالتحقق بخطوتين. افتح تطبيق المصادقة على هاتفك",
      code: "رمز التحقق",
      codeHelp: "الرمز المكوّن من ستة أرقام في التطبيق، أو أحد رموز الاسترداد إن فقدت الهاتف",
      submit: "تحقّق",
      back: "رجوع",
      invalid: "الرمز غير صحيح أو استُخدم من قبل. اكتب الرمز الظاهر الآن في التطبيق",
    },
  },
  recovery: {
    title: "استعادة الدخول برمز من الدعم الفني",
    help: "لصاحب المتجر الذي فقد كلمة مروره: يعطيك الدعم الفني لـ«فيرتكس» رمزًا يصلح مرة واحدة خلال ثلاثين دقيقة. تعيين كلمة المرور به يلغي التحقق بخطوتين، ويُنهي جلساتك المفتوحة",
    code: "رمز الاستعادة",
    codeHelp: "عشرة أحرف وأرقام، مثل ABCDE-FGHJK",
    password: "كلمة المرور الجديدة",
    passwordHelp: "عشرة أحرف على الأقل",
    confirmPassword: "أعد كتابة كلمة المرور الجديدة",
    pin: "رمز سري جديد (اختياري)",
    pinHelp: "اكتبه إن طلب منك الدعم الفني تغييره",
    submit: "تعيين كلمة المرور",
    back: "العودة إلى تسجيل الدخول",
    problem: {
      required: "هذا الحقل مطلوب",
      passwordShort: "عشرة أحرف على الأقل",
      mismatch: "لا يطابق كلمة المرور الجديدة",
      pinInvalid: "من 4 إلى 6 أرقام، لا تتكرر كلها ولا تتسلسل مثل 1234 أو 4321",
      codeInvalid:
        "رمز المتجر أو اسم الدخول أو رمز الاستعادة غير صحيح، أو استُخدم الرمز، أو انتهت مدته",
      throttled: "محاولات فاشلة كثيرة. انتظر ربع ساعة ثم حاول مجددًا",
      invalid: "راجع الحقول ثم حاول مجددًا",
      unreachable: "تعذّر الوصول إلى الخادم. تحقّق من الاتصال ثم حاول مجددًا",
      refused: "رفض الخادم الطلب. حاول مجددًا",
    },
  },
  account: accountMessages,
  userMenu: {
    account: "حسابي",
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
    mainPosLimit: "بلغ المتجر عدد الأجهزة الرئيسية الذي يسمح به اشتراكه",
    companionLimit: "بلغ المتجر عدد الأجهزة المساعدة الذي يسمح به اشتراكه",
    alreadyRegistered: "هذا الجهاز مسجّل من قبل",
    register: {
      title: "تسجيل هذا الجهاز",
      help: "يبيع الجهاز المسجّل دون اتصال، ويرسل مبيعاته إلى الخادم عند عودة الاتصال",
      codeHelp:
        "يصدر صاحب المتجر رمز التسجيل من «الإدارة ← الأجهزة»، ويصلح لجهاز واحد خلال خمس عشرة دقيقة",
      storeCode: "رمز المتجر",
      registrationCode: "رمز التسجيل",
      name: "اسم الجهاز",
      nameHelp: "مثل: الصندوق الرئيسي",
      submit: "تسجيل الجهاز",
    },
    registered: {
      name: "اسم الجهاز",
      prefix: "بادئة أرقام الفواتير",
      type: "نوع الجهاز",
      state: "الحالة",
      ready: "مسجّل وجاهز للبيع",
      bundle: "إعدادات المتجر الموقّعة",
      bundleNone: "لم تصل بعد؛ تصل مع أول مزامنة",
      bundleValid: "الإصدار {version}، موثّقة",
      bundleRefused: "رُفضت آخر نسخة وصلت لأنها لم تجتز التحقق؛ يبقى الإصدار السابق",
      bundleRefusedNone: "رُفضت النسخة التي وصلت لأنها لم تجتز التحقق",
    },
    types: {
      mainPos: "جهاز رئيسي (كاشير)",
      companion: "جهاز مساعد",
    },
    removed: {
      title: "أُزيل هذا الجهاز من المتجر",
      body: "أبطل صاحب المتجر هذا الجهاز. أُرسلت مبيعاته كلها إلى الخادم أولًا، ثم مُسحت بيانات المتجر منه.",
      next: "لاستخدامه مع المتجر من جديد، يسجّله صاحب المتجر برمز تسجيل جديد.",
      action: "متابعة",
    },
  },
  devices: devicesMessages,
  users: usersMessages,
  roles: rolesMessages,
} satisfies Messages;
