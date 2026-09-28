import type { Messages } from "@mustawfi/i18n";

/** The `ui` namespace: text the design-system components show themselves. */
export const UI_NAMESPACE = "ui";

export const uiMessages = {
  /** Currency labels shown next to amounts; the ISO code stays the stored value. */
  currency: {
    SYP: "ل.س",
    USD: "$",
    TRY: "ل.ت",
  },
  moneyInput: {
    currency: "العملة",
    notANumber: "اكتب رقمًا، مثل 1250.50",
    tooPrecise:
      "{scale, plural, zero {بلا خانات عشرية} one {خانة عشرية واحدة على الأكثر} two {خانتان عشريتان على الأكثر} few {# خانات عشرية على الأكثر} many {# خانة عشرية على الأكثر} other {# خانة عشرية على الأكثر}}",
    tooLarge:
      "{digits, plural, zero {المبلغ كبير جدًا} one {المبلغ كبير جدًا: خانة واحدة على الأكثر قبل الفاصلة} two {المبلغ كبير جدًا: خانتان على الأكثر قبل الفاصلة} few {المبلغ كبير جدًا: # خانات على الأكثر قبل الفاصلة} many {المبلغ كبير جدًا: # خانة على الأكثر قبل الفاصلة} other {المبلغ كبير جدًا: # خانة على الأكثر قبل الفاصلة}}",
    negative: "لا يمكن أن يكون المبلغ سالبًا",
    required: "هذا الحقل مطلوب",
  },
  dataTable: {
    empty: "لا توجد بيانات بعد",
  },
  toast: {
    region: "الإشعارات",
    close: "إغلاق الإشعار",
  },
  passwordField: {
    reveal: "إظهار ما كُتب",
  },
  support: {
    whatsapp: "لباقة أكبر راسل دعم «فيرتكس» على واتساب:",
    number: "رقم واتساب الدعم",
  },
  copy: {
    action: "نسخ",
    done: "نُسخ",
    doneFor: "نُسخ {label}",
    failed: "تعذّر النسخ، انسخه يدويًا",
  },
  datePicker: {
    open: "فتح التقويم",
    previous: "الشهر السابق",
    next: "الشهر التالي",
    presets: "فترات جاهزة",
    rangeSeparator: "–",
    preset: {
      today: "اليوم",
      yesterday: "أمس",
      last7: "آخر 7 أيام",
      last30: "آخر 30 يومًا",
      thisMonth: "هذا الشهر",
      lastMonth: "الشهر الماضي",
    },
  },
} satisfies Messages;
