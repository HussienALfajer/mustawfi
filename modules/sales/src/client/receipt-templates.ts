/** A receipt template: its source never changes under its version. */
export interface ReceiptTemplate {
  readonly version: string;
  readonly source: string;
}

/**
 * The skeleton's cash receipt (ADR-0025): HTML/CSS with LiquidJS variables, laid out for an
 * 80 mm printer (576 dots, one CSS pixel per dot). Every invoice records the template version
 * it printed with (non-negotiable 7), so this text never changes under the same version: a
 * change is a new version. Labels come from i18n and figures arrive formatted, so the
 * template holds no language and does no arithmetic. Kept for reprints of the invoices
 * recorded with it.
 */
const SKELETON_CASH_RECEIPT = {
  version: "receipt.skeleton.1",
  source: `<style>
  .r { font-family: "Mustawfi Receipt", sans-serif; font-size: 24px; line-height: 1.35;
       padding: 8px 12px 24px; }
  .r h1 { font-size: 32px; font-weight: 700; text-align: center; margin: 0 0 4px; }
  .r .meta { display: flex; justify-content: space-between; font-size: 22px; }
  .r .num { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
  .r table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .r th { font-size: 20px; font-weight: 700; text-align: start; border-bottom: 2px solid #000; }
  .r td { padding: 4px 0; vertical-align: top; }
  .r .end { text-align: end; }
  .r .total { display: flex; justify-content: space-between; font-size: 32px; font-weight: 700;
              border-top: 6px double #000; margin-top: 8px; padding-top: 6px; }
  .r footer { text-align: center; margin-top: 16px; font-size: 22px; }
</style>
<div class="r">
  <h1>{{ labels.title }}</h1>
  <div class="meta"><span>{{ labels.number }}</span><span class="num">{{ invoice.number }}</span></div>
  <div class="meta"><span>{{ labels.date }}</span><span class="num">{{ invoice.soldAt }}</span></div>
  <div class="meta"><span>{{ labels.device }}</span><span>{{ invoice.device }}</span></div>
  <table>
    <thead><tr>
      <th>{{ labels.item }}</th><th class="end">{{ labels.quantity }}</th>
      <th class="end">{{ labels.price }}</th><th class="end">{{ labels.amount }}</th>
    </tr></thead>
    <tbody>
    {%- for line in lines %}
      <tr><td>{{ line.name }}</td><td class="end num">{{ line.quantity }}</td>
        <td class="end num">{{ line.unitPrice }}</td><td class="end num">{{ line.amount }}</td></tr>
    {%- endfor %}
    </tbody>
  </table>
  <div class="total"><span>{{ labels.total }}</span><span class="num">{{ invoice.total }} {{ invoice.currency }}</span></div>
  <footer>{{ labels.thanks }}</footer>
</div>`,
} as const;

/**
 * The cash receipt since `core-foundation` slice 4: the skeleton's, headed by the store's name
 * from its profile. What every new invoice records.
 */
export const CASH_RECEIPT_TEMPLATE = {
  version: "receipt.cash.2",
  source: `<style>
  .r { font-family: "Mustawfi Receipt", sans-serif; font-size: 24px; line-height: 1.35;
       padding: 8px 12px 24px; }
  .r .store { font-size: 36px; font-weight: 700; text-align: center; margin: 0 0 4px; }
  .r h1 { font-size: 32px; font-weight: 700; text-align: center; margin: 0 0 4px; }
  .r .meta { display: flex; justify-content: space-between; font-size: 22px; }
  .r .num { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
  .r table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .r th { font-size: 20px; font-weight: 700; text-align: start; border-bottom: 2px solid #000; }
  .r td { padding: 4px 0; vertical-align: top; }
  .r .end { text-align: end; }
  .r .total { display: flex; justify-content: space-between; font-size: 32px; font-weight: 700;
              border-top: 6px double #000; margin-top: 8px; padding-top: 6px; }
  .r footer { text-align: center; margin-top: 16px; font-size: 22px; }
</style>
<div class="r">
  {%- if store.name != "" %}
  <div class="store">{{ store.name }}</div>
  {%- endif %}
  <h1>{{ labels.title }}</h1>
  <div class="meta"><span>{{ labels.number }}</span><span class="num">{{ invoice.number }}</span></div>
  <div class="meta"><span>{{ labels.date }}</span><span class="num">{{ invoice.soldAt }}</span></div>
  <div class="meta"><span>{{ labels.device }}</span><span>{{ invoice.device }}</span></div>
  <table>
    <thead><tr>
      <th>{{ labels.item }}</th><th class="end">{{ labels.quantity }}</th>
      <th class="end">{{ labels.price }}</th><th class="end">{{ labels.amount }}</th>
    </tr></thead>
    <tbody>
    {%- for line in lines %}
      <tr><td>{{ line.name }}</td><td class="end num">{{ line.quantity }}</td>
        <td class="end num">{{ line.unitPrice }}</td><td class="end num">{{ line.amount }}</td></tr>
    {%- endfor %}
    </tbody>
  </table>
  <div class="total"><span>{{ labels.total }}</span><span class="num">{{ invoice.total }} {{ invoice.currency }}</span></div>
  <footer>{{ labels.thanks }}</footer>
</div>`,
} as const;

const CASH_RECEIPT_TEMPLATES: ReadonlyMap<string, ReceiptTemplate> = new Map(
  [SKELETON_CASH_RECEIPT, CASH_RECEIPT_TEMPLATE].map((template) => [template.version, template]),
);

/** The receipt template of `version` this client prints with, or `undefined`. */
export function cashReceiptTemplate(version: string): ReceiptTemplate | undefined {
  return CASH_RECEIPT_TEMPLATES.get(version);
}
