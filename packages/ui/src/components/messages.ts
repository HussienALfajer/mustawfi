import type { Messages } from "@mustawfi/i18n";

/** The `ui` namespace: text the design-system components show themselves. */
export const UI_NAMESPACE = "ui";

export const uiMessages = {
  /** Currency labels shown next to amounts; the ISO code stays the stored value. */
  currency: {
    SYP: "ل.س",
    USD: "$",
  },
  moneyInput: {
    currency: "العملة",
    notANumber: "اكتب رقمًا، مثل 1250.50",
    tooPrecise:
      "{scale, plural, zero {بلا خانات عشرية} one {خانة عشرية واحدة على الأكثر} two {خانتان عشريتان على الأكثر} few {# خانات عشرية على الأكثر} many {# خانة عشرية على الأكثر} other {# خانة عشرية على الأكثر}}",
    negative: "لا يمكن أن يكون المبلغ سالبًا",
    required: "هذا الحقل مطلوب",
  },
  dataTable: {
    empty: "لا توجد بيانات بعد",
  },
} satisfies Messages;
