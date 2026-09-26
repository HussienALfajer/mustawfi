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
};
