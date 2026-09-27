import type { Messages } from "@mustawfi/i18n";
import { accountMessages } from "./account/messages.ts";
import { devicesMessages } from "./devices/messages.ts";
import { overrideMessages, pinMessages } from "./pin/messages.ts";
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
  /**
   * The audit log's names for this module's records (`auditEntity`), the fields of their
   * before and after snapshots (`auditField`), and coded values of those fields
   * (`auditValue`), so the log reads in words (`core-foundation` QA slice 26).
   */
  auditEntity: {
    user: "مستخدم",
    role: "دور",
    device: "جهاز",
    session: "جلسة",
    registrationCode: "رمز تسجيل جهاز",
    override: "موافقة مشرف",
  },
  auditField: {
    name: "الاسم",
    login: "اسم الدخول",
    roleId: "الدور",
    departmentScope: "نطاق الأقسام",
    departments: "الأقسام",
    status: "الحالة",
    hasPin: "له رمز سري",
    hasPassword: "له كلمة مرور",
    twoFactor: "التحقق بخطوتين",
    type: "النوع",
    platform: "المنصة",
    prefix: "البادئة",
    registrationCodeId: "رمز التسجيل",
    sessionsRevoked: "الجلسات المنتهية",
    method: "طريقة الدخول",
    scope: "نطاق التقييد",
    secondFactor: "الخطوة الثانية",
    until: "حتى",
    departmentId: "القسم",
    permission: "الصلاحية",
    limit: "الحد",
    value: "القيمة",
    requestedBy: "طلبها",
    failures: "المحاولات الخاطئة",
    lockedAt: "وقت القفل",
    expiresAt: "ينتهي في",
    issuedBy: "أصدره",
    resetCodeId: "رمز الاستعادة",
    staff: "موظف الدعم",
    archivedAt: "وقت الأرشفة",
    isOwner: "دور المالك",
    limits: "الحدود",
    permissions: "الصلاحيات",
    template: "القالب",
    deviceId: "الجهاز",
    reason: "السبب",
    userId: "المستخدم",
    clearedBy: "ألغاه",
    recoveryCodeId: "رمز الاسترداد",
    recoveryCodes: "رموز الاسترداد",
    remaining: "المتبقي",
  },
  auditValue: {
    status: {
      active: "نشط",
      deactivated: "موقوف",
      revoked: "مُزال",
    },
    departmentScope: {
      all: "كل الأقسام",
      listed: "أقسام محددة",
    },
    type: {
      mainPos: "جهاز بيع رئيسي",
      companion: "جهاز مساعد",
    },
    platform: {
      windows: "تطبيق Windows",
      browser: "متصفح",
    },
    method: {
      password: "كلمة المرور",
      pin: "الرمز السري",
    },
    scope: {
      login: "اسم الدخول",
      address: "عنوان الشبكة",
      pin: "الرمز السري على هذا الجهاز",
    },
    secondFactor: {
      totp: "رمز من التطبيق",
      recoveryCode: "رمز استرداد",
      invalid: "رمز غير صحيح",
    },
    template: {
      owner: "المالك",
      accountant: "محاسب",
      sectionCashier: "كاشير قسم",
      repairTechnician: "فني صيانة",
      topUpOperator: "موظف تحويل رصيد",
    },
    hasPin: {
      true: "نعم",
      false: "لا",
    },
    hasPassword: {
      true: "نعم",
      false: "لا",
    },
    twoFactor: {
      true: "نعم",
      false: "لا",
    },
    isOwner: {
      true: "نعم",
      false: "لا",
    },
  },
  /** Labels of this module's audit actions: `access.role.created` → `audit.role.created`. */
  audit: {
    role: {
      created: "إنشاء دور",
      changed: "تعديل دور",
      archived: "أرشفة دور",
      restored: "استعادة دور مؤرشف",
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
      succeeded: "تسجيل دخول",
      failed: "محاولة دخول فاشلة",
      throttled: "إيقاف محاولات الدخول مؤقتًا بعد محاولات فاشلة كثيرة",
    },
    session: {
      revoked: "إنهاء جلسة",
      /** Each reason a session ended (`after.reason`, `SESSION_END_REASONS`), labelled on its own. */
      revokedFor: {
        signedOut: "تسجيل خروج",
        switchedUser: "إنهاء جلسة: تبديل المستخدم على الجهاز",
        locked: "إنهاء جلسة: قفل الجهاز بعد خمس دقائق دون استخدام",
        idle: "إنهاء جلسة: فتح التطبيق بعد خمس دقائق دون استخدام",
        userDeactivated: "إنهاء جلسة: إيقاف المستخدم",
        passwordSet: "إنهاء جلسة: تعيين المدير كلمة مرور جديدة للمستخدم",
        supportReset: "إنهاء جلسة: تعيين كلمة مرور المالك برمز من الدعم الفني",
        deviceRevoked: "إنهاء جلسة: إبطال الجهاز",
        passwordChanged: "إنهاء جلسة: غيّر المستخدم كلمة مروره من جلسة أخرى",
        currentSecretFailures:
          "إنهاء جلسة: خمس محاولات خاطئة للرمز السري أو كلمة المرور الحالية في «حسابي»",
      },
    },
    registrationCode: {
      issued: "إصدار رمز تسجيل جهاز",
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
      registered: "تسجيل جهاز",
      renamed: "إعادة تسمية جهاز",
      revoked: "إبطال جهاز",
      wiped: "مسح الجهاز المُبطَل بياناته",
    },
    pin: {
      signedIn: "دخول بالرمز السري على الجهاز دون اتصال",
      failed: "رمز سري خاطئ على الجهاز دون اتصال",
      lockedOut: "قفل مستخدم على الجهاز بعد خمسة رموز خاطئة",
      unlocked: "فتح مشرف قفل مستخدم على الجهاز",
    },
    override: {
      granted: "موافقة مشرف على إجراء على الجهاز",
      refused: "رفض موافقة مشرف لا يملك دوره الإجراء",
    },
  },
  login: {
    title: "تسجيل الدخول",
    storeCode: "رمز المتجر",
    storeCodeHelp: "ستة أحرف وأرقام، تجده عند صاحب المتجر",
    storeCodeKnown: "رمز المتجر الذي سُجّل فيه هذا الجهاز",
    storeCodeShape: "رمز المتجر ستة أحرف لاتينية وأرقام، ليس فيها O ولا I ولا 0 ولا 1، مثل K7M3QX",
    login: "اسم الدخول",
    password: "كلمة المرور",
    submit: "دخول",
    submitting: "جارٍ الدخول…",
    required: "هذا الحقل مطلوب",
    failed: "رمز المتجر أو اسم الدخول أو كلمة المرور غير صحيح",
    /** `{minutes}`: 0 for a moment (`throttleWaitMinutes`). */
    throttled:
      "{minutes, plural, zero {محاولات كثيرة في اللحظة نفسها. انتظر لحظة ثم حاول مجددًا} one {محاولات فاشلة كثيرة. حاول مجددًا بعد دقيقة} two {محاولات فاشلة كثيرة. حاول مجددًا بعد دقيقتين} few {محاولات فاشلة كثيرة. حاول مجددًا بعد # دقائق} many {محاولات فاشلة كثيرة. حاول مجددًا بعد # دقيقة} other {محاولات فاشلة كثيرة. حاول مجددًا بعد # دقيقة}}",
    deviceRequired: "لم يعد هذا الجهاز معروفًا لدى المتجر. سجّله من جديد أو ادخل من متصفح آخر",
    deviceRevoked:
      "أُزيل هذا الجهاز من المتجر. ادخل من جهاز آخر، أو اطلب من صاحب المتجر تسجيله من جديد",
    unreachable: "تعذّر الوصول إلى الخادم. تحقّق من الاتصال ثم حاول مجددًا",
    suspended:
      "ترخيص المتجر موقوف، فلا يدخل إلا المالكون حتى يُجدَّد. اطلب من صاحب المتجر تجديد الترخيص",
    refused: "رُفض الطلب. أعد تحميل الصفحة ثم حاول مجددًا",
    passwordWasReset: "عُيّنت كلمة المرور الجديدة. ادخل بها الآن",
    sessionEnded: {
      ended:
        "انتهت جلستك، فادخل من جديد. تنتهي الجلسة بمرور سبعة أيام، أو بتغيير كلمة مرورك من جهاز آخر، أو بإيقاف حسابك، أو بإزالة الجهاز الذي فتحتها عليه",
      currentSecret:
        "انتهت جلستك بعد خمس محاولات خاطئة للرمز السري أو كلمة المرور الحالية في «حسابي»، فادخل من جديد",
    },
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
      storeCodeShape:
        "رمز المتجر ستة أحرف لاتينية وأرقام، ليس فيها O ولا I ولا 0 ولا 1، مثل K7M3QX",
      pinInvalid: "من 4 إلى 6 أرقام، لا تتكرر كلها ولا تتسلسل مثل 1234 أو 4321",
      codeInvalid:
        "رمز المتجر أو اسم الدخول أو رمز الاستعادة غير صحيح، أو استُخدم الرمز، أو انتهت مدته",
      throttled:
        "{minutes, plural, zero {محاولات كثيرة في اللحظة نفسها. انتظر لحظة ثم حاول مجددًا} one {محاولات فاشلة كثيرة. حاول مجددًا بعد دقيقة} two {محاولات فاشلة كثيرة. حاول مجددًا بعد دقيقتين} few {محاولات فاشلة كثيرة. حاول مجددًا بعد # دقائق} many {محاولات فاشلة كثيرة. حاول مجددًا بعد # دقيقة} other {محاولات فاشلة كثيرة. حاول مجددًا بعد # دقيقة}}",
      invalid: "راجع الحقول ثم حاول مجددًا",
      unreachable: "تعذّر الوصول إلى الخادم. تحقّق من الاتصال ثم حاول مجددًا",
      refused: "رفض الخادم الطلب. حاول مجددًا",
    },
  },
  account: accountMessages,
  userMenu: {
    account: "حسابي",
    switchUser: "تبديل المستخدم",
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
    storeCodeShape: "رمز المتجر ستة أحرف لاتينية وأرقام، ليس فيها O ولا I ولا 0 ولا 1، مثل K7M3QX",
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
      mainPos: "جهاز بيع رئيسي",
      companion: "جهاز مساعد",
    },
    platforms: {
      windows: "تطبيق Windows",
      browser: "متصفح",
    },
    /** A device's type in words with its platform (`useDeviceKind`). */
    kind: "{platform} — {type}",
    /** The license limit a device counts against (rule 4), before the numbers are known. */
    countsAgainst: {
      mainPosDevices: "يُحسب ضمن أجهزة البيع الرئيسية في اشتراك المتجر",
      companionDevices: "يُحسب ضمن الأجهزة المساعدة في اشتراك المتجر",
    },
    countsAgainstUse: {
      mainPosDevices: "يُحسب ضمن أجهزة البيع الرئيسية: {used} من {allowed}",
      companionDevices: "يُحسب ضمن الأجهزة المساعدة: {used} من {allowed}",
    },
    registersAs: "يُسجَّل هذا الجهاز بوصفه «{kind}».",
    removed: {
      title: "أُزيل هذا الجهاز من المتجر",
      body: "أبطل صاحب المتجر هذا الجهاز. أُرسلت مبيعاته كلها إلى الخادم أولًا، ثم مُسحت بيانات المتجر منه.",
      next: "لاستخدامه مع المتجر من جديد: يُصدر صاحب المتجر رمز تسجيل جديدًا من «الأجهزة»، ثم يُكتب الرمز في «تسجيل الجهاز» بعد الدخول هنا بكلمة المرور.",
      action: "متابعة",
    },
  },
  devices: devicesMessages,
  pin: pinMessages,
  override: overrideMessages,
  users: usersMessages,
  roles: rolesMessages,
} satisfies Messages;
