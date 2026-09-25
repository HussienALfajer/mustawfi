import { contrastRatio, hexToOklch } from "../tokens/color.ts";
import { checkContrast, type ContrastResult } from "../tokens/contrast.ts";
import { generateTokenCss, themeDeclarations } from "../tokens/css.ts";
import { type Palette, RAMP_SPECS, STEPS } from "../tokens/palette.ts";
import { DENSITIES, type DensityName, FONT_WEIGHTS, TYPE_SCALE } from "../tokens/scale.ts";
import {
  ALIASES,
  primitiveName,
  resolveTheme,
  SEMANTIC_TOKENS,
  THEMES,
  type ThemeName,
} from "../tokens/themes.ts";

/**
 * The design-system preview page (walking-skeleton slice 9): palette, semantic tokens, every
 * contrast pair, type scale, densities, amounts, and the double-rule total, in light and dark.
 * A developer tool, not product UI — its Arabic text is fixed sample copy, not i18n.
 */

export interface PreviewOptions {
  readonly palette: Palette;
  /** Stylesheets that load the bundled fonts (relative paths, or a font service for a hosted copy). */
  readonly fontStylesheets: readonly string[];
  /**
   * A fragment for a host page that supplies the document shell and stamps `data-theme` itself
   * (none when following the OS), instead of a standalone document.
   */
  readonly hosted?: boolean;
}

const escape = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const THEME_LABELS: Record<ThemeName, string> = { light: "الفاتح", dark: "الداكن" };
const DENSITY_LABELS: Record<DensityName, string> = {
  compact: "مضغوط — الجداول والتقارير",
  comfortable: "مريح — النماذج والإعدادات (الافتراضي)",
  touch: "لمس — نقطة البيع والأجهزة اللوحية",
};

/** Text that reads the same way in every hex swatch: whichever of black or white contrasts more. */
function inkFor(hex: string): string {
  return contrastRatio(hex, "#FFFFFF") >= contrastRatio(hex, "#000000") ? "#FFFFFF" : "#000000";
}

function paletteSection(palette: Palette): string {
  const aliasOf = Object.fromEntries(Object.entries(ALIASES).map(([alias, ramp]) => [ramp, alias]));
  const rows = RAMP_SPECS.map((spec) => {
    const swatches = STEPS.map((step) => {
      const hex = palette[spec.name][step];
      const anchor = spec.pins[step] !== undefined;
      return `<div class="swatch" style="background:${hex};color:${inkFor(hex)}">
  <span class="step">${step}${anchor ? ' <b class="anchor" title="مرساة من ADR-0024">●</b>' : ""}</span>
  <code>${hex}</code><span class="l">L ${hexToOklch(hex).l.toFixed(3)}</span>
</div>`;
    }).join("");
    return `<div class="ramp"><h3><code>${spec.name}</code> ← <code>${aliasOf[spec.name] ?? ""}</code></h3><div class="swatches">${swatches}</div></div>`;
  }).join("");
  return `<section id="palette"><h2>١. السلالم اللونية (الطبقة الأولية)</h2>
<p class="note">كل مرساة من ADR-0024 (مؤشَّرة بـ ●) مُثبَّتة بقيمتها الحرفية، والدرجات الأخرى مولّدة في OKLCH. الورق <code>paper</code> <span class="chip" style="background:#F7F7F5"></span> <code>#F7F7F5</code> والأبيض <code>white</code> <span class="chip" style="background:#FFFFFF"></span> <code>#FFFFFF</code> قيمتان ثابتتان خارج السلالم.</p>
${rows}</section>`;
}

function semanticSection(palette: Palette): string {
  const resolved = {
    light: resolveTheme(palette, THEMES.light),
    dark: resolveTheme(palette, THEMES.dark),
  };
  const cell = (theme: ThemeName, token: (typeof SEMANTIC_TOKENS)[number]): string => {
    const hex = resolved[theme][token];
    return `<td><span class="chip" style="background:${hex}"></span> <code>${primitiveName(THEMES[theme][token])}</code> <code>${hex}</code></td>`;
  };
  const rows = SEMANTIC_TOKENS.map(
    (token) =>
      `<tr><th scope="row"><code>--mf-color-${token}</code></th>${cell("light", token)}${cell("dark", token)}</tr>`,
  ).join("");
  return `<section id="semantic"><h2>٢. الرموز الدلالية</h2>
<p class="note">الشاشات تستعمل هذه الرموز فقط. الثيم الداكن مصمَّم من المراسي نفسها وليس قلبًا للفاتح.</p>
<div class="scroll"><table class="grid"><thead><tr><th scope="col">الرمز</th><th scope="col">الفاتح</th><th scope="col">الداكن</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function contrastTable(theme: ThemeName, palette: Palette): string {
  const resolved = resolveTheme(palette, THEMES[theme]);
  const results: ContrastResult[] = checkContrast(resolved);
  const rows = results
    .map((result) => {
      const fg = resolved[result.foreground];
      const bg = resolved[result.background];
      const sample =
        result.kind === "text"
          ? `<span style="color:${fg}">نص تجريبي 1,250.00</span>`
          : `<span class="ring" style="border-color:${fg}"></span>`;
      return `<tr><td style="background:${bg}">${sample}</td><td><code>${result.foreground}</code></td><td><code>${result.background}</code></td><td>${result.kind === "text" ? "نص" : "غير نصي"}</td><td class="num">${result.ratio.toFixed(2)}</td><td class="num">${result.minimum.toFixed(1)}</td><td>${result.passes ? "✓ ناجح" : "✗ راسب"}</td></tr>`;
    })
    .join("");
  const failing = results.filter((result) => !result.passes).length;
  return `<h3>الثيم ${THEME_LABELS[theme]} — ${results.length} زوجًا، ${failing} راسب</h3>
<div class="scroll"><table class="grid"><thead><tr><th scope="col">عيّنة</th><th scope="col">الأمامي</th><th scope="col">الخلفية</th><th scope="col">النوع</th><th scope="col">النسبة</th><th scope="col">الحد الأدنى</th><th scope="col">النتيجة</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function typeSection(): string {
  const sizes = Object.entries(TYPE_SCALE)
    .map(
      ([name, { size, lineHeight }]) =>
        `<div class="type-row"><code>${name} · ${size}/${lineHeight}</code><p style="font-size:${size}px;line-height:${lineHeight}px">فاتورة بيع نقدي لقسم الإكسسوارات — الإجمالي <span class="figures">1,250,000.00</span></p></div>`,
    )
    .join("");
  const weights = Object.entries(FONT_WEIGHTS)
    .map(
      ([name, weight]) => `<span style="font-weight:${weight}">${name} ${weight} — مستوفي</span>`,
    )
    .join("");
  return `<section id="type"><h2>٤. سلّم الخط</h2>
<p class="note">IBM Plex Sans Arabic للواجهة، IBM Plex Sans للمقاطع اللاتينية، IBM Plex Mono للأكواد وأرقام المستندات. لا خط أصغر من 12px، ولا مائل، والأرقام بعرض ثابت.</p>
${sizes}<div class="weights">${weights}</div>
<p>رقم المستند <bdi class="machine">K7-INV-000123</bdi> و IMEI <bdi class="machine">356938035643809</bdi> يبقيان من اليسار إلى اليمين داخل النص العربي.</p></section>`;
}

const amount = (text: string, currency: string): string => {
  const negative = text.startsWith("−");
  return `<span class="money${negative ? " negative" : ""}"><bdi class="amount">${text}</bdi> <span class="currency">${currency}</span></span>`;
};

function densitySection(): string {
  const panels = (Object.keys(DENSITIES) as DensityName[])
    .map((name) => {
      const density = DENSITIES[name];
      return `<div class="density-panel" data-density="${name}">
<h3>${DENSITY_LABELS[name]}</h3>
<p class="note">ارتفاع العنصر ${density.controlHeight}px، الصف ${density.rowHeight}px، الخط ${density.fontSize}/${density.lineHeight}.</p>
<label class="field"><span>اسم المنتج</span><input type="text" value="شاحن سريع 25 واط"></label>
<div class="buttons"><button class="primary" type="button">حفظ المنتج</button><button class="secondary" type="button">إلغاء</button></div>
<table class="data"><thead><tr><th scope="col">المنتج</th><th scope="col" class="num">الكمية</th><th scope="col" class="num">السعر</th></tr></thead>
<tbody><tr><td>سماعة لاسلكية</td><td class="num">2</td><td class="num">${amount("35.00", "USD")}</td></tr>
<tr class="alt"><td>كفر حماية</td><td class="num">5</td><td class="num">${amount("45,000.00", "SYP")}</td></tr>
<tr class="selected"><td>شحن رصيد</td><td class="num">1</td><td class="num">${amount("100,000.00", "SYP")}</td></tr></tbody></table>
</div>`;
    })
    .join("");
  return `<section id="density"><h2>٥. الكثافات</h2><div class="densities">${panels}</div></section>`;
}

function moneySection(): string {
  const rows: [string, string, string][] = [
    ["بيع نقدي", "1,250,000.00", "SYP"],
    ["دفعة من زبون", "340.50", "USD"],
    ["مرتجع", "−75,000.00", "SYP"],
    ["خصم", "−12.25", "USD"],
    ["سحب المالك", "−2,000,000.00", "SYP"],
  ];
  const body = rows
    .map(
      ([label, text, currency]) =>
        `<tr><td>${label}</td><td class="num">${amount(text, currency)}</td></tr>`,
    )
    .join("");
  return `<section id="money"><h2>٦. المبالغ (<code>Money</code>)</h2>
<p class="note">لا يظهر مبلغ دون عملته. الأرقام بعرض ثابت ومحاذاة إلى نهاية العمود، والمبلغ جزيرة من اليسار إلى اليمين، والسالب يحمل إشارة الطرح ولون الخطر معًا. (صيغة الأرقام وأسماء العملات النهائية تحدَّد مع i18n في الشريحة 10.)</p>
<table class="data money-table"><thead><tr><th scope="col">الحركة</th><th scope="col" class="num">المبلغ</th></tr></thead><tbody>${body}</tbody></table></section>`;
}

function totalSection(): string {
  return `<section id="total"><h2>٧. الإجمالي بالخط المزدوج</h2>
<p class="note">توقيع المنتج: خط نحاسي مزدوج تحت الإجمالي النهائي للمستند — «مُقفل ومتوازن». النحاسي زخرفي فقط، لا نص ولا حالة.</p>
<div class="document">
<div class="doc-head"><span>فاتورة بيع</span><bdi class="machine">K7-INV-000123</bdi></div>
<dl class="summary">
<div><dt>المجموع قبل الخصم</dt><dd>${amount("1,295,000.00", "SYP")}</dd></div>
<div><dt>الخصم</dt><dd>${amount("−45,000.00", "SYP")}</dd></div>
<div class="grand"><dt>الإجمالي</dt><dd>${amount("1,250,000.00", "SYP")}</dd></div>
</dl></div></section>`;
}

function statusSection(): string {
  const alerts: [string, string, string][] = [
    ["positive", "✓", "تمت المزامنة: أُرسلت 3 فواتير إلى الخادم."],
    ["negative", "✗", "تعذّر ترحيل القيد: المدين لا يساوي الدائن."],
    ["warning", "!", "الجهاز غير متصل: البيع مستمر، و5 عمليات بانتظار الإرسال."],
    ["info", "i", "سعر الصرف لليوم لم يُحدَّد بعد."],
  ];
  const body = alerts
    .map(
      ([kind, icon, text]) =>
        `<div class="alert ${kind}" role="status"><span class="icon" aria-hidden="true">${icon}</span><p>${text} <span class="secondary">منذ دقيقتين</span></p></div>`,
    )
    .join("");
  return `<section id="status"><h2>٨. الحالات</h2>
<p class="note">اللون لا يكون الإشارة الوحيدة: كل حالة تحمل رمزًا ونصًا.</p>${body}
<p><a href="#palette">رابط بلون الحبر</a> · <span class="muted">نص خافت على الورق</span></p></section>`;
}

const PAGE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{background:var(--mf-color-page);color:var(--mf-color-text);font-family:var(--mf-font-sans);font-size:var(--mf-density-font-size);line-height:var(--mf-density-line-height);font-variant-numeric:tabular-nums}
body{margin:0;padding-block:24px;padding-inline:16px;max-width:1200px;margin-inline:auto}
h1,h2,h3{font-weight:var(--mf-font-weight-semibold)}
h1{font-weight:var(--mf-font-weight-bold);font-size:var(--mf-font-size-3xl);line-height:var(--mf-line-height-3xl);margin:0}
h2{font-size:var(--mf-font-size-xl);line-height:var(--mf-line-height-xl);margin-block:32px 8px}
h3{font-size:var(--mf-font-size-md);line-height:var(--mf-line-height-md);margin-block:16px 8px}
code,.machine{font-family:var(--mf-font-mono);font-size:var(--mf-font-size-xs)}
.machine{direction:ltr;unicode-bidi:isolate}
a{color:var(--mf-color-text-accent)}
.note,.secondary{color:var(--mf-color-text-secondary)}
.muted{color:var(--mf-color-text-muted)}
section{background:var(--mf-color-surface);padding:16px;margin-block-end:16px;border-radius:var(--mf-radius-md)}
header{display:flex;flex-wrap:wrap;gap:16px;align-items:end;justify-content:space-between;margin-block-end:16px}
.mark{display:inline-block;padding-block-end:6px;border-block-end:4px double var(--mf-total-rule)}
.endorse{color:var(--mf-color-text-secondary);margin:0}
.controls{display:flex;flex-wrap:wrap;gap:16px}
.controls fieldset{border:1px solid var(--mf-color-border-field);border-radius:var(--mf-radius-md);display:flex;gap:4px;padding:4px 8px}
.controls legend{font-size:var(--mf-font-size-xs);color:var(--mf-color-text-secondary)}
.swatches{display:grid;grid-template-columns:repeat(11,minmax(0,1fr));gap:2px}
.swatch{padding:6px 4px;border-radius:var(--mf-radius-sm);display:flex;flex-direction:column;gap:2px;min-height:72px;direction:ltr}
.swatch code,.swatch .l,.swatch .step{font-size:12px;line-height:16px}
.anchor{font-size:12px}
.chip{display:inline-block;inline-size:20px;block-size:20px;border:1px solid var(--mf-color-border-field);border-radius:var(--mf-radius-sm);vertical-align:middle}
.ring{display:inline-block;inline-size:40px;block-size:20px;border:3px solid;border-radius:var(--mf-radius-md);vertical-align:middle}
table{border-collapse:collapse;inline-size:100%}
.grid th,.grid td{text-align:start;padding:4px 8px;border-block-end:1px solid var(--mf-color-divider)}
.grid td:first-child{min-inline-size:160px}
.num{text-align:end}
.scroll{overflow-x:auto}
.type-row{display:grid;grid-template-columns:140px 1fr;gap:16px;align-items:baseline;border-block-end:1px solid var(--mf-color-divider)}
.type-row p{margin:4px 0}
.weights{display:flex;flex-wrap:wrap;gap:24px;margin-block:16px}
.figures{font-variant-numeric:tabular-nums}
.densities{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px}
.density-panel{font-size:var(--mf-density-font-size);line-height:var(--mf-density-line-height);border:1px solid var(--mf-color-divider);border-radius:var(--mf-radius-md);padding:var(--mf-padding-block) var(--mf-padding-inline)}
.field{display:flex;flex-direction:column;gap:4px;margin-block-end:var(--mf-gap)}
.field span{font-weight:var(--mf-font-weight-medium)}
input{font:inherit;color:var(--mf-field-text);background:var(--mf-field-bg);border:1px solid var(--mf-field-border);border-radius:var(--mf-radius-sm);block-size:var(--mf-control-height);padding-inline:var(--mf-padding-inline)}
input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--mf-color-focus-ring);outline-offset:2px}
.buttons{display:flex;gap:var(--mf-gap);margin-block-end:var(--mf-gap)}
button{font:inherit;font-weight:var(--mf-font-weight-medium);min-block-size:var(--mf-control-height);min-inline-size:var(--mf-control-height);padding-inline:var(--mf-padding-inline);border-radius:var(--mf-radius-sm);cursor:pointer;transition:background-color var(--mf-duration-fast)}
button.primary{background:var(--mf-button-primary-bg);color:var(--mf-button-primary-text);border:1px solid var(--mf-button-primary-bg)}
button.primary:hover{background:var(--mf-button-primary-bg-hover)}
button.secondary,.controls button{background:var(--mf-color-surface);color:var(--mf-color-text-accent);border:1px solid var(--mf-color-border-field)}
.controls button[aria-pressed="true"]{background:var(--mf-color-selected);font-weight:var(--mf-font-weight-semibold)}
.data th,.data td{block-size:var(--mf-row-height);padding-inline:var(--mf-padding-inline);text-align:start;border-block-end:1px solid var(--mf-color-divider)}
.data th{color:var(--mf-color-text-secondary);font-weight:var(--mf-font-weight-medium)}
.data th.num,.data td.num{text-align:end}
.data tr.alt{background:var(--mf-row-alt-bg)}
.data tr.selected{background:var(--mf-row-selected-bg)}
.money{white-space:nowrap;font-variant-numeric:tabular-nums}
.money .amount{direction:ltr;unicode-bidi:isolate}
.money .currency{font-family:var(--mf-font-mono);font-size:var(--mf-font-size-xs);color:var(--mf-color-text-secondary)}
.money.negative .amount{color:var(--mf-color-text-negative)}
.money-table{max-inline-size:480px}
.document{max-inline-size:420px;border:1px solid var(--mf-color-divider);padding:16px;border-radius:var(--mf-radius-md)}
.doc-head{display:flex;justify-content:space-between;font-weight:var(--mf-font-weight-semibold);margin-block-end:8px}
.summary{margin:0}
.summary div{display:flex;justify-content:space-between;padding-block:4px}
.summary dd{margin:0}
.summary .grand{font-weight:var(--mf-font-weight-semibold);font-size:var(--mf-font-size-lg);line-height:var(--mf-line-height-lg);border-block-start:1px solid var(--mf-color-divider);margin-block-start:4px;padding-block-start:8px}
.summary .grand dd{padding-block-end:4px;border-block-end:4px double var(--mf-total-rule)}
.alert{display:flex;gap:12px;align-items:start;padding:8px 12px;border-radius:var(--mf-radius-md);margin-block-end:8px}
.alert p{margin:0}
.alert .icon{font-weight:var(--mf-font-weight-bold);inline-size:20px;text-align:center}
.alert.positive{background:var(--mf-color-positive-tint)}.alert.positive .icon{color:var(--mf-color-text-positive)}
.alert.negative{background:var(--mf-color-negative-tint)}.alert.negative .icon{color:var(--mf-color-text-negative)}
.alert.warning{background:var(--mf-color-warning-tint)}.alert.warning .icon{color:var(--mf-color-text-warning)}
.alert.info{background:var(--mf-color-info-tint)}.alert.info .icon{color:var(--mf-color-text-info)}
@media (max-width:720px){.swatches{grid-template-columns:repeat(4,minmax(0,1fr))}.type-row{grid-template-columns:1fr}}
`;

const PAGE_SCRIPT = `
const root = document.documentElement;
for (const group of document.querySelectorAll("[data-axis]")) {
  const axis = group.dataset.axis;
  for (const button of group.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      root.setAttribute("data-" + axis, button.value);
      for (const other of group.querySelectorAll("button")) other.setAttribute("aria-pressed", String(other === button));
    });
  }
}
`;

export function generatePreviewHtml({
  palette,
  fontStylesheets,
  hosted = false,
}: PreviewOptions): string {
  const fonts = fontStylesheets
    .map((href) => `<link rel="stylesheet" href="${escape(href)}">`)
    .join("\n");
  const toggle = (
    axis: string,
    legend: string,
    options: [string, string][],
    current: string,
  ): string =>
    `<fieldset data-axis="${axis}"><legend>${legend}</legend>${options
      .map(
        ([value, label]) =>
          `<button type="button" value="${value}" aria-pressed="${value === current}">${label}</button>`,
      )
      .join("")}</fieldset>`;
  // A host that follows the OS stamps no theme attribute, so the dark values also apply to a
  // bare root when the OS is dark.
  const hostedCss = hosted
    ? `@media (prefers-color-scheme: dark) {
:root:not([data-theme]) {
${themeDeclarations("dark").join("\n")}
}
}
`
    : "";
  const head = `<title>Mustawfi design tokens</title>
${fonts}
<style>
${generateTokenCss(palette)}
${hostedCss}${PAGE_CSS}
</style>`;
  const content = `<header>
<div><h1 class="mark">مستوفي</h1><p class="endorse">من Vertex System — معاينة نظام التصميم «حبر وورق» (ADR-0024)</p></div>
<div class="controls">
${toggle(
  "theme",
  "الثيم",
  [
    ["light", "فاتح"],
    ["dark", "داكن"],
    ["system", "حسب النظام"],
  ],
  "system",
)}
${toggle(
  "density",
  "الكثافة",
  [
    ["compact", "مضغوط"],
    ["comfortable", "مريح"],
    ["touch", "لمس"],
  ],
  "comfortable",
)}
</div>
</header>
${paletteSection(palette)}
${semanticSection(palette)}
<section id="contrast"><h2>٣. التباين — كل زوج، بلا استثناءات</h2>
<p class="note">النص 4.5:1 على الأقل بكل الأحجام، والعناصر غير النصية وحدود الحقول 3:1. الاختبار نفسه يُفشل البناء في CI.</p>
${contrastTable("light", palette)}${contrastTable("dark", palette)}</section>
${typeSection()}
${densitySection()}
${moneySection()}
${totalSection()}
${statusSection()}
<script>${PAGE_SCRIPT}</script>`;
  if (hosted) {
    return `${head}
<script>document.documentElement.lang = "ar"; document.documentElement.dir = "rtl";</script>
${content}
`;
  }
  return `<!doctype html>
<html lang="ar" dir="rtl" data-theme="system" data-density="comfortable">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
</head>
<body>
${content}
</body>
</html>
`;
}
