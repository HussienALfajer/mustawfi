/** Arabic strings of the «License and plan» screen (`organization` namespace, `license.`). */
export const licenseMessages = {
  loading: "جارٍ تحميل بيانات الترخيص…",
  loadFailed: "تعذّر تحميل بيانات الترخيص",
  offline: "لا اتصال بالخادم. تُعرض بيانات الترخيص عند عودة الاتصال",
  retry: "إعادة المحاولة",
  plan: {
    title: "الباقة",
    name: "الباقة",
    state: "حالة الترخيص",
    expiresAt: "تاريخ الانتهاء",
    names: {
      basic: "الأساسية",
      phonesPro: "الاحترافية لمحلات الموبايل",
      supermarketPro: "الاحترافية للسوبرماركت",
    },
    renew: "للتجديد أو لتغيير الباقة تواصل مع Vertex System.",
  },
  /** The lifecycle states as words (glossary: «حالة الترخيص»). */
  state: {
    active: "ساري",
    expiring: "ينتهي قريبًا",
    grace: "مهلة سماح",
    readOnly: "قراءة فقط",
    suspended: "موقوف",
  },
  /** What each state means for the store, with the date of the next one. */
  explain: {
    active: "الترخيص ساري حتى {expiresAt}.",
    expiring: "ينتهي الترخيص في {expiresAt}. جدّده قبل ذلك لتبقى الحسابات دون قيود.",
    grace:
      "انتهى الترخيص في {expiresAt} والمتجر في مهلة السماح. يصبح للقراءة فقط في {readOnlyAt} إن لم يُجدَّد.",
    readOnly:
      "المتجر للقراءة فقط منذ {readOnlyAt}: لا يُسجَّل أي مستند جديد ولا يُعدَّل شيء، ويبقى العرض والتصدير. يُوقَف في {suspendedAt} إن لم يُجدَّد.",
    suspended: "المتجر موقوف منذ {suspendedAt}: لا يدخل إلا المالكون، ويبقى العرض والتصدير.",
  },
  limits: {
    title: "حدود الباقة",
    description:
      "المستخدم من المسموح في ترخيصك. تخفيض الباقة لا يوقف شيئًا، لكنه يمنع الإضافة حتى ينزل العدد تحت الحد.",
    limit: "الحد",
    usage: "المستخدم من المسموح",
    manage: "إدارة",
    usedOfAllowed: "{used} من {allowed}",
    reached: "مكتمل",
    over: "متجاوز",
    name: {
      users: "المستخدمون النشطون",
      departments: "الأقسام النشطة",
      mainPosDevices: "الأجهزة الرئيسية (كاشير)",
      companionDevices: "الأجهزة المساعدة (موبايل)",
    },
  },
  /** The top bar: a warning to owners, a restriction to everyone (`core-foundation` rule 10). */
  notice: {
    expiring: "ينتهي الترخيص في {date}",
    grace: "انتهى الترخيص، ومهلة السماح حتى {date}",
    readOnly: "المتجر للقراءة فقط",
    suspended: "المتجر موقوف",
    clockBehind: "ساعة الجهاز متأخرة",
    clockWrong: "ساعة الجهاز غير مضبوطة",
    bundleMissing: "بانتظار إعدادات المتجر",
    bundleRefused: "إعدادات المتجر لم تجتز التحقق",
    offlineTooLong: "الجهاز منقطع منذ مدة طويلة",
  },
  /** Why this device records no new document (rule 9), where one would be made. */
  restriction: {
    title: "لا يُسجَّل أي مستند جديد على هذا الجهاز الآن",
    readOnly:
      "المتجر للقراءة فقط منذ {date} لأن الترخيص لم يُجدَّد. يبقى العرض، وتبقى السلة محفوظة، ويعود البيع فور تجديد الترخيص.",
    suspended:
      "ترخيص المتجر موقوف منذ {date}، فلا يدخل إلا المالكون. يبقى العرض، وتبقى السلة محفوظة، ويعود البيع فور تجديد الترخيص.",
    clockBehind:
      "ساعة هذا الجهاز أُرجعت إلى الوراء. صحّح التاريخ والوقت في الجهاز، ثم اتصل بالإنترنت ليتحقق الجهاز من الوقت.",
    clockWrong:
      "ساعة هذا الجهاز تختلف عن وقت الخادم بأكثر من نصف ساعة، فستحمل المستندات تاريخًا أو وقتًا خاطئًا. اضبط التاريخ والوقت والمنطقة الزمنية في الجهاز، ويعود البيع بعد المزامنة التالية.",
    bundleMissing:
      "لم تصل إعدادات المتجر الموقّعة إلى هذا الجهاز بعد. اتصل بالإنترنت لتصل مع المزامنة.",
    bundleRefused:
      "رفض هذا الجهاز آخر إعدادات وصلته لأنها لم تجتز التحقق من التوقيع. يعود البيع حين تصل إعدادات سليمة مع المزامنة.",
    offlineTooLong:
      "لم يتصل هذا الجهاز بالخادم منذ أطول مما يسمح به الترخيص. اتصل بالإنترنت، ويعود البيع بعد أول مزامنة.",
    renew: "للتجديد يتواصل صاحب المتجر مع Vertex System.",
  },
  /** «Store suspended» (notice): what a non-owner sees instead of the app (rule 9). */
  suspended: {
    title: "المتجر موقوف",
    body: "ترخيص هذا المتجر موقوف، فلا يدخل إلا المالكون حتى يُجدَّد.",
    since: "ترخيص هذا المتجر موقوف منذ {date}، فلا يدخل إلا المالكون حتى يُجدَّد.",
    next: "اطلب من صاحب المتجر تجديد الترخيص مع Vertex System، ثم ادخل من جديد.",
    signOut: "تسجيل الخروج",
  },
};
