import type { Messages } from "@mustawfi/i18n";

/** The `sales` namespace (ADR-0023: one namespace per module, shipped in its client entry). */
export const SALES_NAMESPACE = "sales";

export const salesMessages = {
  /** The module's name over its permissions in the roles screen's matrix. */
  moduleName: "المبيعات",
  /** Labels of this module's permissions: `sales.invoice.create` → `permission.invoice.create`. */
  permission: {
    invoices: { view: "عرض الفواتير" },
    invoice: { create: "البيع وإنشاء الفواتير" },
  },
  /** Labels of this module's audit actions: `sales.invoice.created` → `audit.invoice.created`. */
  audit: {
    invoice: { created: "تسجيل فاتورة بيع" },
  },
  pos: {
    title: "البيع",
    loading: "جارٍ قراءة بيانات الجهاز…",
    localFailed: "تعذّر فتح قاعدة البيانات المحلية لهذا الجهاز؛ لا يمكن البيع",
    unregistered: "هذا الجهاز غير مسجّل، فلا يبيع دون اتصال. سجّله أولًا من صفحة الجهاز",
    otherStore: "هذا الجهاز مسجّل لمتجر آخر؛ لا يمكن البيع عليه بهذا الحساب",
    scan: {
      label: "الباركود",
      help: "امسحه بالقارئ، أو اكتبه ثم اضغط Enter",
      notFound: "لا يوجد منتج بهذا الباركود على هذا الجهاز",
      failed: "تعذّرت إضافة المنتج إلى السلة. حاول مجددًا",
    },
    products: {
      title: "المنتجات على هذا الجهاز",
      empty: "لا منتجات على هذا الجهاز بعد؛ تصل مع المزامنة",
      column: {
        name: "المنتج",
        barcode: "الباركود",
        price: "السعر",
        action: "إضافة",
      },
      add: "أضف",
      addNamed: "أضف {name} إلى السلة",
    },
    cart: {
      title: "السلة",
      empty: "السلة فارغة. امسح منتجًا أو أضفه من القائمة",
      column: {
        name: "المنتج",
        quantity: "الكمية",
        price: "السعر",
        amount: "المبلغ",
        action: "إزالة",
      },
      remove: "احذف",
      removeNamed: "احذف {name} من السلة",
      missing: "منتج لم يعد على هذا الجهاز",
      otherCurrency: "مسعّر بعملة أخرى؛ البيع الآن بعملة المتجر فقط",
      total: "الإجمالي",
      changeFailed: "تعذّر تعديل السلة على هذا الجهاز. حاول مجددًا",
    },
    complete: "إتمام البيع نقدًا",
    completing: "جارٍ التسجيل…",
    emptyReason: "أضف منتجًا إلى السلة لإتمام البيع",
    notSellableReason: "احذف من السلة ما لا يمكن بيعه لإتمام البيع",
    licenseReason: "البيع متوقف على هذا الجهاز الآن، والسبب مبيّن فوق السلة",
    licensePendingReason: "جارٍ التحقق من ترخيص المتجر على هذا الجهاز…",
    licenseFailedReason:
      "تعذّر التحقق من ترخيص المتجر على هذا الجهاز، فلا يُسجَّل البيع. أعد تشغيل التطبيق",
    recorded: "سُجّل البيع:",
    failed: "تعذّر تسجيل البيع على هذا الجهاز، ولم يُسجَّل منه شيء. حاول مجددًا",
    noDepartment:
      "لم تصل أقسام المتجر إلى هذا الجهاز بعد، فلم يُسجَّل البيع. اتصل بالإنترنت ليتزامن الجهاز، ثم حاول مجددًا",
    recent: {
      title: "آخر فواتير هذا الجهاز",
      empty: "لا فواتير على هذا الجهاز بعد",
      column: {
        number: "رقم الفاتورة",
        total: "الإجمالي",
        state: "المزامنة",
        receipt: "الإيصال",
      },
      state: {
        pending: "بانتظار الإرسال",
        accepted: "وصلت إلى الخادم",
        duplicate: "وصلت إلى الخادم",
        rejected: "رُفضت، وتحتاج مراجعة",
      },
    },
  },
  /** The printed receipt: labels the receipt template shows. */
  receipt: {
    title: "فاتورة مبيع نقدي",
    number: "رقم الفاتورة",
    date: "التاريخ",
    device: "الجهاز",
    item: "الصنف",
    quantity: "الكمية",
    price: "السعر",
    amount: "المبلغ",
    total: "الإجمالي",
    thanks: "شكرًا لزيارتكم",
  },
  invoices: {
    title: "المبيعات المسجّلة على الخادم",
    loading: "جارٍ تحميل المبيعات…",
    loadFailed: "تعذّر تحميل المبيعات من الخادم. تحقّق من الاتصال ثم حاول مجددًا",
    retry: "إعادة المحاولة",
    empty: "لم تصل أي فاتورة إلى الخادم بعد",
    date: "تاريخ البيع",
    total: "الإجمالي",
    flags: {
      label: "ملاحظات للمحاسب",
      none: "لا ملاحظات",
      negativeStock: "مخزون سالب",
      arithmeticMismatch: "حساب لا يطابق",
    },
    entry: {
      title: "القيد المحاسبي",
      none: "لا قيد: بيع بلا مبلغ",
      account: "الحساب",
      debit: "مدين",
      credit: "دائن",
    },
  },
} satisfies Messages;
