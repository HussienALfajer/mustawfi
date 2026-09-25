/**
 * The receipt's bundled font (ADR-0025): IBM Plex Sans Arabic, owned by the print pipeline
 * rather than borrowed from the page's CSS, so the receipt is laid out and drawn with exactly
 * the same glyphs — Arabic, Latin, digits, and spaces — offline and on every client.
 * Templates name it as `font-family: "Mustawfi Receipt"`.
 */
export const RECEIPT_FONT_FAMILY = "Mustawfi Receipt";

/** Unicode ranges of the two subsets a receipt needs (as `@fontsource/ibm-plex-sans-arabic`). */
const SUBSET_RANGES = {
  arabic:
    "U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC",
  latin:
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
} as const;

/** One WOFF2 file of the receipt font: the app passes the URL of its own bundled copy. */
export interface ReceiptFontSource {
  readonly subset: keyof typeof SUBSET_RANGES;
  readonly weight: 400 | 700;
  readonly url: string;
}

/** The loaded receipt font, as CSS with the font files inlined. */
export interface ReceiptFonts {
  readonly cssText: string;
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    text += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(text);
}

/**
 * Loads and decodes each file once, and returns the faces as `@font-face` rules with data URLs
 * under {@link RECEIPT_FONT_FAMILY}, for the receipt frame and the drawing. Call it when the app
 * starts, so a receipt printed later never fetches anything.
 */
export async function loadReceiptFonts(
  sources: readonly ReceiptFontSource[],
): Promise<ReceiptFonts> {
  const rules = await Promise.all(
    sources.map(async (source) => {
      const response = await fetch(source.url);
      if (!response.ok)
        throw new Error(`receipt font ${source.url}: HTTP ${String(response.status)}`);
      const dataUrl = `data:font/woff2;base64,${toBase64(new Uint8Array(await response.arrayBuffer()))}`;
      const unicodeRange = SUBSET_RANGES[source.subset];
      const face = new FontFace(RECEIPT_FONT_FAMILY, `url("${dataUrl}") format("woff2")`, {
        weight: String(source.weight),
        unicodeRange,
      });
      // Decoding it now fails a broken file at start-up, not at the first receipt.
      await face.load();
      return `@font-face { font-family: "${RECEIPT_FONT_FAMILY}"; font-style: normal; font-weight: ${String(source.weight)}; src: url("${dataUrl}") format("woff2"); unicode-range: ${unicodeRange}; }`;
    }),
  );
  return { cssText: rules.join("\n") };
}
