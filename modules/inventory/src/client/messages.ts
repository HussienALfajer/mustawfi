import type { Messages } from "@mustawfi/i18n";

/** The `inventory` namespace (ADR-0023: one namespace per module, shipped in its client entry). */
export const INVENTORY_NAMESPACE = "inventory";

export const inventoryMessages = {
  /** The module's name over its permissions in the roles screen's matrix. */
  moduleName: "المخزون",
  /** Labels of this module's permissions: `inventory.products.view` → `permission.products.view`. */
  permission: {
    products: { view: "عرض المنتجات", manage: "إضافة المنتجات وتعديلها" },
  },
  /**
   * The audit log's names for this module's records (`auditEntity`), the fields of their
   * before and after snapshots (`auditField`), and coded values of those fields
   * (`auditValue`), so the log reads in words (`core-foundation` QA slice 26).
   */
  auditEntity: {
    product: "منتج",
  },
  auditField: {
    name: "الاسم",
    barcode: "الباركود",
    price: "السعر",
  },
  /** Labels of this module's audit actions: `inventory.product.created` → `audit.product.created`. */
  audit: {
    product: { created: "إضافة منتج" },
  },
  products: {
    title: "المنتجات",
    count:
      "{count, plural, zero {لا منتجات} one {منتج واحد} two {منتجان} few {# منتجات} many {# منتجًا} other {# منتج}}",
    empty: "لا توجد منتجات بعد. أضف أول منتج من النموذج أعلاه",
    loading: "جارٍ تحميل المنتجات…",
    loadFailed: "تعذّر تحميل المنتجات. تحقّق من الاتصال ثم حاول مجددًا",
    retry: "إعادة المحاولة",
    column: {
      name: "الاسم",
      barcode: "الباركود",
      price: "السعر",
    },
  },
  newProduct: {
    title: "إضافة منتج",
    name: "اسم المنتج",
    barcode: "الباركود",
    barcodeHelp: "اختياري. امسحه بالقارئ أو اكتبه",
    price: "سعر البيع",
    submit: "إضافة المنتج",
    submitting: "جارٍ الإضافة…",
    added: "أُضيف المنتج «{name}»",
    required: "هذا الحقل مطلوب",
    tooLong: "النص أطول من المسموح",
    barcodeInvalid: "الباركود حروف وأرقام ورموز لاتينية بلا مسافات",
    barcodeTaken: "هذا الباركود مسجّل لمنتج آخر",
    unreachable: "تعذّر الوصول إلى الخادم؛ لم يُحفظ المنتج. حاول مجددًا",
    readOnly:
      "المتجر للقراءة فقط لأن الترخيص لم يُجدَّد، فلا يُضاف منتج. يعود الحفظ فور تجديد الترخيص",
    refused: "رفض الخادم المنتج. راجع الحقول ثم حاول مجددًا",
  },
} satisfies Messages;
