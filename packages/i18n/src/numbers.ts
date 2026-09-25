import { LOCALE } from "./locale.ts";

/**
 * How digits are drawn (ADR-0023): Western `0–9` by default, Arabic-Indic `٠–٩` as a per-user
 * display setting. It never changes stored values or parsing; codes, IMEIs, barcodes, and
 * document numbers are always Western.
 */
export type DigitShape = "latn" | "arab";

export const DEFAULT_DIGIT_SHAPE: DigitShape = "latn";

const CANONICAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;

export interface FormatDecimalOptions {
  readonly digits?: DigitShape;
  /** Pad the fraction to at least this many places, e.g. the currency's minor units. */
  readonly minimumFractionDigits?: number;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(digits: DigitShape, fractionDigits: number, minimum: number) {
  const key = `${digits}:${String(fractionDigits)}:${String(minimum)}`;
  let cached = formatters.get(key);
  if (cached === undefined) {
    cached = new Intl.NumberFormat(LOCALE, {
      numberingSystem: digits,
      minimumFractionDigits: minimum,
      maximumFractionDigits: fractionDigits,
      useGrouping: true,
    });
    formatters.set(key, cached);
  }
  return cached;
}

/**
 * Formats canonical decimal text (`"1250.5"`) for display, exactly: `Intl.NumberFormat` reads
 * the string as a decimal, never as a float, and the fraction keeps every digit it has (no
 * rounding here — rounding happens only at the kernel's named points, ADR-0018).
 */
export function formatDecimal(value: string, options: FormatDecimalOptions = {}): string {
  if (!CANONICAL.test(value)) throw new RangeError(`Not a canonical decimal: "${value}"`);
  const minimum = options.minimumFractionDigits ?? 0;
  const scale = value.split(".")[1]?.length ?? 0;
  return formatter(options.digits ?? DEFAULT_DIGIT_SHAPE, Math.max(scale, minimum), minimum).format(
    value as Intl.StringNumericLiteral,
  );
}

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/** Western digits for Arabic-Indic (`٠–٩`) and extended Arabic-Indic (`۰–۹`) ones. */
export function toWesternDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const zero =
      code >= EXTENDED_ARABIC_INDIC_ZERO ? EXTENDED_ARABIC_INDIC_ZERO : ARABIC_INDIC_ZERO;
    return String.fromCharCode(0x30 + code - zero);
  });
}

/**
 * Reads what a person typed into an amount field as canonical decimal text, or `undefined`
 * when it is not a number. Accepts Western and Arabic-Indic digits, the Arabic decimal
 * separator `٫`, grouping marks (`,` `٬`) between groups of three digits, spaces, and bidi
 * marks. Never goes through a float.
 */
export function parseDecimalInput(text: string): string | undefined {
  const cleaned = toWesternDigits(text)
    .replace(/[\s‎‏؜]/g, "")
    .replace(/٬/g, ",")
    .replace(/٫/g, ".")
    .replace(/^−/, "-");
  const match = /^(-?)([\d,]*)(?:\.(\d*))?$/.exec(cleaned);
  if (match === null) return undefined;
  const [, sign = "", grouped = "", fraction = ""] = match;
  // Grouping marks only between groups of three: "12,5" is a decimal comma, not 125.
  if (grouped.includes(",") && !/^\d{1,3}(,\d{3})+$/.test(grouped)) return undefined;
  const whole = grouped.replaceAll(",", "");
  if (whole === "" && fraction === "") return undefined;
  const integer = whole.replace(/^0+(?=\d)/, "") || "0";
  const canonical = fraction === "" ? integer : `${integer}.${fraction}`;
  return sign === "-" && /[1-9]/.test(canonical) ? `-${canonical}` : canonical;
}
