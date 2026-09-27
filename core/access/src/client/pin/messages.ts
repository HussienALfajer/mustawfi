/** The PIN screen's text, under `pin.` in the `access` namespace. */
export const pinMessages = {
  title: "من يستخدم الجهاز؟",
  titleReconnect: "أدخل رمزك للاتصال بالخادم",
  reconnectHelp:
    "الخادم متاح، ولا جلسة لك عليه من هذا الجهاز الآن. أدخل رمزك السري مرة أخرى لفتح جلسة عليه.",
  users: "المستخدمون على هذا الجهاز",
  tileLocked: "مقفل على هذا الجهاز",
  noBundle:
    "لم تصل إعدادات المتجر الموقّعة إلى هذا الجهاز بعد. ادخل بكلمة المرور، أو انتظر المزامنة ثم أعد المحاولة.",
  noUsers: "لا أحد على هذا الجهاز له رمز سري بعد. ادخل بكلمة المرور ثم عيّن رمزك من «حسابي».",
  notRegistered: "الدخول بالرمز السري يحتاج إلى جهاز مسجَّل في المتجر.",
  passwordLink: "الدخول بكلمة المرور",
  pinFor: "الرمز السري لـ {name}",
  pad: "لوحة الأرقام",
  erase: "مسح",
  submit: "دخول",
  back: "رجوع",
  cancel: "إلغاء",
  checking: "جارٍ التحقق…",
  pinRequired: "أدخل الرمز السري",
  wrongPin:
    "{attemptsLeft, plural, one {الرمز غير صحيح. بقيت محاولة واحدة قبل قفل {name} على هذا الجهاز} two {الرمز غير صحيح. بقيت محاولتان قبل قفل {name} على هذا الجهاز} few {الرمز غير صحيح. بقيت # محاولات قبل قفل {name} على هذا الجهاز} other {الرمز غير صحيح. بقيت # محاولة قبل قفل {name} على هذا الجهاز}}",
  wrongPinOnline: "الرمز غير صحيح.",
  lockedOut: "أُقفل {name} على هذا الجهاز بعد خمس محاولات خاطئة.",
  locked: "{name} مقفل على هذا الجهاز بعد خمس محاولات خاطئة.",
  // Online, the server checks the PIN and a right one lifts the device's lockout (slice 15).
  lockedHelp: "يفتح القفلَ مشرفٌ برمزه، أو يُفتح بالرمز الصحيح حين يتصل الجهاز بالخادم.",
  unlockAction: "فتح القفل بواسطة مشرف",
  unlockTitle: "فتح قفل {name}",
  chooseSupervisor: "اختر المشرف",
  supervisors: "المشرفون على هذا الجهاز",
  noSupervisors: "لا أحد على هذا الجهاز يملك صلاحية فتح القفل.",
  supervisorPin: "رمز المشرف {name}",
  notAllowed: "لا يملك {name} صلاحية فتح القفل.",
  notLocked: "لم يعد {name} مقفلًا.",
  unlocked: "فُتح قفل {name}. أدخل الرمز السري للدخول.",
  unavailable: "لا رمز سري لهذا المستخدم على هذا الجهاز.",
  noBundleOffline: "لا اتصال بالخادم، ولم تصل إعدادات المتجر إلى هذا الجهاز بعد.",
  unreachable: "لا اتصال بالخادم. أعد المحاولة حين يعود الاتصال.",
  /** `{minutes}`: 0 for a moment (`throttleWaitMinutes`). */
  throttled:
    "{minutes, plural, zero {محاولات كثيرة في اللحظة نفسها. انتظر لحظة ثم أعد المحاولة.} one {محاولات خاطئة كثيرة. أعد المحاولة بعد دقيقة.} two {محاولات خاطئة كثيرة. أعد المحاولة بعد دقيقتين.} few {محاولات خاطئة كثيرة. أعد المحاولة بعد # دقائق.} many {محاولات خاطئة كثيرة. أعد المحاولة بعد # دقيقة.} other {محاولات خاطئة كثيرة. أعد المحاولة بعد # دقيقة.}}",
  suspended: "المتجر موقوف: يدخل المالكون وحدهم حتى يُجدَّد الترخيص.",
  deviceRevoked: "أُزيل هذا الجهاز من المتجر، فلا يُقبل الدخول منه.",
  deviceRequired: "الخادم لا يعرف هذا الجهاز. سجّله من جديد.",
  refused: "رفض الخادم الدخول. أعد المحاولة.",
  failed: "تعذّر التحقق من الرمز. أعد المحاولة.",
} as const;

/** The supervisor override dialog's text, under `override.` in the `access` namespace. */
export const overrideMessages = {
  title: "موافقة مشرف",
  chooseSupervisor: "اختر المشرف الذي يوافق",
  supervisors: "المشرفون الذين يملكون الموافقة",
  noSupervisors: "لا أحد على هذا الجهاز يملك الموافقة على هذا الإجراء.",
  supervisorPin: "رمز المشرف {name}",
  notCovered: "لا يملك {name} صلاحية الموافقة على هذا الإجراء.",
  notAllowed: "لا يوافق المستخدم على إجرائه بنفسه.",
  back: "رجوع",
  cancel: "إلغاء",
  failed: "تعذّر التحقق من الموافقة. أعد المحاولة.",
} as const;
