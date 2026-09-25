import type { Messages } from "@mustawfi/i18n";

/** The `shell` namespace: the app frame around module screens. */
export const SHELL_NAMESPACE = "shell";

export const shellMessages = {
  mark: "مستوفي",
  /** The mark in the collapsed side navigation. */
  markInitial: "م",
  vendor: "من Vertex System",
  skipToContent: "انتقل إلى المحتوى",
  nav: {
    label: "التنقل الرئيسي",
    collapse: "طيّ القائمة",
    expand: "توسيع القائمة",
    group: {
      sales: "المبيعات",
      inventory: "المخزون",
      administration: "الإدارة",
      device: "هذا الجهاز",
    },
    pos: "البيع",
    invoices: "الفواتير",
    products: "المنتجات",
    profile: "بيانات المتجر",
    departments: "الأقسام",
    device: "تسجيل الجهاز",
    printer: "الطابعة",
  },
  /** Page titles in the top bar. */
  pages: {
    pos: "البيع",
    invoices: "الفواتير",
    products: "المنتجات",
    profile: "بيانات المتجر",
    departments: "الأقسام",
    device: "هذا الجهاز",
    printer: "الطابعة",
  },
  registerDevice: "تسجيل هذا الجهاز",
  localDbUnavailable:
    "تعذّر فتح قاعدة البيانات المحلية، فلا يمكن البيع على هذا الجهاز. إن كان التطبيق مفتوحًا في نافذة أخرى فأغلقها ثم أعد تحميل الصفحة",
  signedInAs: "{name}",
  sessionFailed: "تعذّر التحقق من الجلسة. تحقّق من الاتصال ثم أعد تحميل الصفحة",
  notFound: "الصفحة غير موجودة",
  home: "العودة إلى المنتجات",
  printing: {
    title: "طابعة الإيصالات",
    browserOnly:
      "الطباعة من تطبيق Windows فقط. في المتصفح يمكنك معاينة الإيصال من صفحة البيع دون طباعته",
    loading: "جارٍ قراءة الطابعات المثبّتة…",
    listFailed: "تعذّرت قراءة الطابعات المثبّتة على هذا الجهاز",
    printer: "الطابعة",
    noneChosen: "لم تُختر طابعة",
    defaultPrinter: "{name} (الافتراضية)",
    missing: "الطابعة «{name}» لم تعد مثبّتة على هذا الجهاز. اختر غيرها",
    paper: "عرض الورق",
    paper80: "80 مم (576 نقطة)",
    paper58: "58 مم (384 نقطة)",
    cut: "قصّ الورق بعد الإيصال",
    openDrawer: "فتح درج النقود مع كل إيصال",
    raw: "يُرسل الإيصال صورةً بأوامر ESC/POS مباشرة إلى الطابعة (وضع RAW)، فلا تغيّره إعدادات برنامج التعريف",
    preview: "معاينة الإيصال",
    previewNamed: "معاينة إيصال الفاتورة {number}",
    previewAlt: "إيصال الفاتورة {number}",
    print: "اطبع الإيصال",
    printNamed: "اطبع إيصال الفاتورة {number}",
    prepared:
      "جُهّز الإيصال في {total} م.ث (القالب {render}، الرسم {rasterize}، الترميز {encode})، {bytes} بايت",
    printed:
      "أُرسل الإيصال إلى الطابعة في {total} م.ث (القالب {render}، الرسم {rasterize}، الترميز {encode}، الإرسال {send})، {bytes} بايت",
    noPrinter: "لم تُختر طابعة لهذا الجهاز.",
    choosePrinter: "اختر الطابعة",
    prepareFailed: "تعذّر تجهيز الإيصال. حاول مجددًا",
    printFailed: "تعذّر إرسال الإيصال إلى الطابعة. تحقّق من أنها موصولة وتعمل ثم حاول مجددًا",
  },
} satisfies Messages;
