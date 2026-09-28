import type { Messages } from "@mustawfi/i18n";

/** The `currency` namespace (ADR-0023: one namespace per module, shipped in its client entry). */
export const CURRENCY_NAMESPACE = "currency";

export const currencyMessages = {
  /** The module's name over its permissions in the roles screen's matrix. */
  moduleName: "العملات",
  /** Labels of this module's permissions: `currency.rate.set` → `permission.rate.set`. */
  permission: {
    rate: { set: "تحديد سعر الصرف" },
    settings: { manage: "إدارة إعدادات العملات" },
  },
  /** Each catalog currency by name; its symbol is the `ui` namespace's `currency.<code>`. */
  name: {
    SYP: "الليرة السورية",
    USD: "الدولار الأمريكي",
    TRY: "الليرة التركية",
  },
  /**
   * The audit log's names for this module's records (`auditEntity`) and the fields of their
   * snapshots (`auditField`), so the log reads in words (`core-foundation` QA slice 26).
   */
  auditEntity: {
    exchangeRate: "سعر صرف",
    tenantCurrency: "عملة",
    settings: "إعدادات العملات",
  },
  auditField: {
    currencies: "العملات",
    changeCurrency: "عملة الباقي",
    rateChangeThresholdPercent: "حد تأكيد تغيّر السعر (%)",
    unitCurrency: "العملة",
    quoteCurrency: "مقابل",
    rate: "السعر",
    effectiveAt: "ساري منذ",
    deviceEffectiveAt: "وقت الجهاز",
    confirmed: "مؤكَّد رغم تجاوز الحد",
    current: "أصبح السعر الحالي",
    code: "العملة",
    enabled: "مفعّلة",
    cashRoundingStep: "خطوة تقريب النقد",
  },
  /** Labels of this module's audit actions: `currency.currencies.seeded` → `audit.currencies.seeded`. */
  audit: {
    currencies: { seeded: "إعداد عملات المتجر الأساسية" },
    rate: { set: "تحديد سعر الصرف" },
    currency: {
      enabled: "تفعيل عملة",
      disabled: "إيقاف عملة",
      updated: "تعديل خطوة تقريب عملة",
    },
    settings: { updated: "تعديل إعدادات العملات" },
  },
  /** The exchange rates screen (`core-money` flow 1). */
  rates: {
    loading: "جارٍ تحميل أسعار الصرف…",
    loadFailed: "تعذّر تحميل أسعار الصرف.",
    offline:
      "لا يوجد اتصال بالخادم: أسعار الصرف تُعرض على هذه الشاشة من الخادم لأن هذا المتصفح ليس جهازًا مسجّلًا.",
    retry: "إعادة المحاولة",
    intro:
      "السعر الحالي لكل عملة مفعّلة مقابل العملة الأساسية. يُطبَّق السعر الجديد فورًا على هذا الجهاز ويصل إلى باقي الأجهزة عند المزامنة.",
    none: "لا توجد عملة أجنبية مفعّلة.",
    direction: "{quote} لكل 1 {unit}",
    current: "السعر الحالي",
    setAt: "حُدِّد في {at}",
    setAtBy: "حُدِّد في {at} بواسطة {name}",
    pending: "بانتظار المزامنة",
    noRate: "لم يُحدَّد سعر بعد: لا يمكن استخدام هذه العملة في مستند جديد حتى يُحدَّد سعرها.",
    stale: "هذا السعر محدَّد قبل يوم العمل الحالي.",
    newRate: "السعر الجديد ({direction})",
    newRateHelp: "رقم موجب، حتى 12 خانة قبل الفاصلة و6 بعدها.",
    save: "حفظ السعر",
    saved: "حُفظ سعر {currency}: {rate}",
    readOnly: "يسمح لك دورك بالاطلاع على الأسعار فقط.",
    problem: {
      rateInvalid: "أدخل سعرًا موجبًا، حتى 12 خانة قبل الفاصلة و6 بعدها.",
      invalidPair: "لا يمكن تحديد سعر لهذه العملة: ربما أوقفها المالك. أعد تحميل الشاشة.",
      withoutBase: "لا يمكن تحديد سعر لهذه العملة مقابل العملة الأساسية.",
      inverted: "لا يمكن تحديد سعر لهذه العملة مقابل العملة الأساسية.",
      disabled: "هذه العملة موقوفة: فعّلها من إعدادات العملات أولًا.",
      permissionDenied: "لا يسمح لك دورك بتحديد سعر الصرف.",
      readOnly: "المتجر للقراءة فقط: لا يمكن تحديد سعر جديد الآن.",
      unreachable: "لا يوجد اتصال بالخادم: لم يُحفظ السعر. أعد المحاولة عند عودة الاتصال.",
      refused: "لم يُحفظ السعر. أعد المحاولة.",
    },
    confirm: {
      title: "تأكيد تغيّر السعر",
      body: "يختلف السعر الجديد عن الحالي بأكثر من {threshold}%. تأكد أنه بالليرة الجديدة وليس القديمة.",
      old: "السعر الحالي",
      new: "السعر الجديد",
      change: "التغيّر",
      example: "مثال",
      confirm: "تأكيد السعر",
      cancel: "مراجعة السعر",
    },
    history: {
      title: "آخر الأسعار",
      empty: "لا توجد أسعار بعد.",
      at: "الوقت",
      currency: "العملة",
      rate: "السعر",
      by: "بواسطة",
      where: "المصدر",
      online: "عبر الإنترنت",
      thisDevice: "هذا الجهاز",
      otherDevice: "جهاز آخر",
      unknownUser: "مستخدم آخر",
      current: "الحالي",
    },
  },
  /** The stale-rate banner on the POS and the start screen (rule 12). */
  stale: {
    old: "سعر {currency} محدَّد قبل اليوم ({at}). البيع مستمر بالسعر الحالي.",
    missing: "لم يُحدَّد سعر {currency} بعد: لا يمكن استخدامه في مستند جديد.",
    setRate: "تحديد السعر",
  },
  /** The currency settings screen (`core-money` flow 2). */
  settings: {
    loading: "جارٍ تحميل إعدادات العملات…",
    loadFailed: "تعذّر تحميل إعدادات العملات.",
    offline: "لا يوجد اتصال بالخادم: إعدادات العملات تحتاج الاتصال.",
    retry: "إعادة المحاولة",
    currencies: {
      title: "العملات المفعّلة",
      description:
        "العملات التي تظهر في المستندات والشاشات الجديدة. إيقاف عملة لا يحذف أرصدتها ولا تاريخها.",
      base: "العملة الأساسية: مفعّلة دائمًا.",
      firstRate: "السعر الأول ({direction})",
      firstRateHelp: "مطلوب لتفعيل عملة ليس لها سعر بعد.",
      firstRateOptional: "هذه العملة مفعّلة بلا سعر: أدخل سعرها الأول هنا أو من شاشة أسعار الصرف.",
    },
    rounding: {
      title: "تقريب النقد",
      description: "المبلغ المستحق نقدًا يُقرَّب إلى مضاعفات هذه الخطوة. 0.01 يعني بلا تقريب.",
      step: "خطوة تقريب {currency}",
      stepHelp: "مضاعف 0.01، و1000 على الأكثر.",
    },
    change: {
      title: "عملة الباقي",
      description: "العملة التي يُعاد بها الباقي للزبون.",
      label: "عملة الباقي",
    },
    threshold: {
      title: "تأكيد تغيّر السعر",
      description: "إذا اختلف السعر الجديد عن الحالي بأكثر من هذه النسبة يُطلب تأكيده.",
      label: "النسبة (%)",
      help: "عدد صحيح من 1 إلى 100.",
    },
    save: "حفظ",
    cancel: "تراجع عن التغييرات",
    dirty: "تغييرات غير محفوظة",
    saved: "حُفظت إعدادات العملات.",
    leave: {
      title: "مغادرة دون حفظ؟",
      body: "لم تُحفظ تغييرات إعدادات العملات. إذا غادرت الآن ستضيع.",
      confirm: "مغادرة دون حفظ",
      cancel: "البقاء",
    },
    problem: {
      stepInvalid: "أدخل خطوة موجبة من مضاعفات 0.01، و1000 على الأكثر.",
      thresholdInvalid: "أدخل عددًا صحيحًا من 1 إلى 100.",
      firstRateRequired: "أدخل السعر الأول لتفعيل هذه العملة.",
      rateInvalid: "أدخل سعرًا موجبًا، حتى 12 خانة قبل الفاصلة و6 بعدها.",
      changeCurrencyDisabled: "عملة الباقي يجب أن تكون مفعّلة: اختر عملة باقٍ أخرى قبل إيقافها.",
      baseDisabled: "العملة الأساسية مفعّلة دائمًا.",
      firstRateUnexpected: "تغيّرت أسعار الصرف في أثناء التعديل. أعد تحميل الشاشة.",
      permissionDenied: "لا يسمح لك دورك بتعديل إعدادات العملات.",
      readOnly: "المتجر للقراءة فقط: لا يمكن الحفظ الآن.",
      invalid: "بعض القيم غير صالحة. راجع الحقول المعلَّمة.",
      unreachable: "لا يوجد اتصال بالخادم: لم تُحفظ الإعدادات. أعد المحاولة عند عودة الاتصال.",
      refused: "لم تُحفظ الإعدادات. أعد المحاولة.",
    },
  },
} satisfies Messages;
