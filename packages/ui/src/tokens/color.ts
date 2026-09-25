/**
 * Colour math for the token generator (ADR-0024): sRGB hex ↔ OKLCH, gamut mapping, and
 * WCAG 2 contrast. Plain floats are fine here — colours are not money.
 */

export interface Oklch {
  /** Perceptual lightness, 0–1. */
  readonly l: number;
  /** Chroma, 0 to about 0.37 inside sRGB. */
  readonly c: number;
  /** Hue in degrees, 0–360. */
  readonly h: number;
}

type Rgb = readonly [number, number, number];

const HEX = /^#[0-9A-F]{6}$/;

/** Parses `#RRGGBB` (upper case, the form every token uses) into 0–1 channels. */
export function parseHex(hex: string): Rgb {
  if (!HEX.test(hex)) throw new Error(`Not an upper-case #RRGGBB colour: ${hex}`);
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(1 + i, 3 + i), 16) / 255) as unknown as Rgb;
}

function toHex(rgb: Rgb): string {
  return (
    "#" +
    rgb
      .map((channel) =>
        Math.round(Math.min(1, Math.max(0, channel)) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
      .toUpperCase()
  );
}

function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function fromLinear(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = parseHex(hex).map(toLinear) as unknown as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(a, bb);
  const hue = chroma < 1e-6 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { l: lightness, c: chroma, h: hue };
}

/** Linear sRGB channels of an OKLCH colour, possibly outside 0–1 (out of gamut). */
function oklchToLinearRgb({ l: lightness, c, h }: Oklch): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inGamut(color: Oklch): boolean {
  return oklchToLinearRgb(color).every((channel) => channel >= -1e-7 && channel <= 1 + 1e-7);
}

/**
 * The sRGB hex of an OKLCH colour. Out-of-gamut colours keep their lightness and hue and lose
 * chroma (binary search) until they fit.
 */
export function oklchToHex(color: Oklch): string {
  let fitted = color;
  if (!inGamut(color)) {
    let low = 0;
    let high = color.c;
    for (let i = 0; i < 32; i += 1) {
      const mid = (low + high) / 2;
      if (inGamut({ ...color, c: mid })) low = mid;
      else high = mid;
    }
    fitted = { ...color, c: low };
  }
  return toHex(oklchToLinearRgb(fitted).map(fromLinear) as unknown as Rgb);
}

/** WCAG 2 relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(toLinear) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1–21, unrounded. */
export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
