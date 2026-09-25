/** Dots across the paper at 203 dpi (ADR-0025). */
export const PAPER_DOTS = { mm80: 576, mm58: 384 } as const;
export type PaperWidth = keyof typeof PAPER_DOTS;

/** An RGBA image, one pixel per printer dot, as `ImageData` holds it. */
export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** Luminance at or above this is paper; below it, a burnt dot. */
export const DEFAULT_THRESHOLD = 128;

/**
 * Turns a raster into the 1-bit image the printer burns (step 3 of ADR-0025), still as RGBA so
 * it can be shown or exported: each pixel is black or white. Transparent pixels count as paper.
 * The encoder applies the same threshold again, which leaves a 1-bit image unchanged, so the
 * preview is exactly what prints.
 */
export function toMonochrome(raster: Raster, threshold = DEFAULT_THRESHOLD): Raster {
  const data = new Uint8ClampedArray(raster.data.length);
  for (let i = 0; i < raster.data.length; i += 4) {
    const alpha = (raster.data[i + 3] ?? 0) / 255;
    // Composite over white, then ITU-R BT.601 luminance.
    const r = (raster.data[i] ?? 0) * alpha + 255 * (1 - alpha);
    const g = (raster.data[i + 1] ?? 0) * alpha + 255 * (1 - alpha);
    const b = (raster.data[i + 2] ?? 0) * alpha + 255 * (1 - alpha);
    const value = 0.299 * r + 0.587 * g + 0.114 * b >= threshold ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return { width: raster.width, height: raster.height, data };
}
