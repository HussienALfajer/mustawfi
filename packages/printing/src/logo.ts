import { DEFAULT_THRESHOLD, type Raster, toMonochrome } from "./raster.ts";
import { rasterToPngUrl } from "./rasterize.ts";

/**
 * How a receipt prints a logo (`core-foundation` slice 21): `threshold` («شعار خطّي») burns each
 * dot darker than the threshold — sharp edges for a drawn logo; `dither` («صورة») diffuses each
 * dot's error to its neighbours (Floyd–Steinberg), so a photo's greys print as patterns of dots.
 */
export type LogoPrintMode = "threshold" | "dither";

/**
 * The most a logo takes on the receipt, in dots: narrower than a 58 mm roll's printable width
 * (384 dots less the receipt's margins), and short enough to leave the receipt its content.
 */
export const RECEIPT_LOGO_BOX = { width: 360, height: 160 } as const;

/** A small logo is enlarged at most this much: more would print its pixels as blocks. */
const MAX_ENLARGEMENT = 2;

/**
 * The logo's size on the receipt: its own proportions, within `box`, enlarged at most twice.
 * The width is even, so the logo centred on an even-width receipt starts on a whole dot and its
 * 1-bit pixels land on dots exactly (half a dot would blur them, and the receipt's threshold
 * would then redraw them).
 */
export function fitLogo(
  width: number,
  height: number,
  box: { readonly width: number; readonly height: number } = RECEIPT_LOGO_BOX,
): { readonly width: number; readonly height: number } {
  const scale = Math.min(box.width / width, box.height / height, MAX_ENLARGEMENT);
  const fitted = Math.max(2, Math.round((width * scale) / 2) * 2);
  return { width: Math.min(fitted, box.width), height: Math.max(1, Math.round(height * scale)) };
}

/** Luminance of each pixel composited over white (ITU-R BT.601), as `toMonochrome` reads it. */
function luminance(raster: Raster): Float32Array {
  const values = new Float32Array(raster.width * raster.height);
  for (let pixel = 0; pixel < values.length; pixel += 1) {
    const i = pixel * 4;
    const alpha = (raster.data[i + 3] ?? 0) / 255;
    const r = (raster.data[i] ?? 0) * alpha + 255 * (1 - alpha);
    const g = (raster.data[i + 1] ?? 0) * alpha + 255 * (1 - alpha);
    const b = (raster.data[i + 2] ?? 0) * alpha + 255 * (1 - alpha);
    values[pixel] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return values;
}

/**
 * Error diffusion (Floyd–Steinberg): each pixel becomes black or white by the threshold, and the
 * difference is passed on — 7/16 to the next pixel, 3/16, 5/16, and 1/16 to the row below — so
 * the share of black dots in an area follows its grey. Returns a 1-bit image as RGBA, which the
 * receipt's own threshold leaves unchanged.
 */
export function ditherToMonochrome(raster: Raster, threshold = DEFAULT_THRESHOLD): Raster {
  const { width, height } = raster;
  const values = luminance(raster);
  const data = new Uint8ClampedArray(width * height * 4);
  const spread = (x: number, y: number, amount: number) => {
    if (x < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    values[index] = (values[index] ?? 0) + amount;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const old = values[index] ?? 0;
      const value = old >= threshold ? 255 : 0;
      const error = old - value;
      spread(x + 1, y, (error * 7) / 16);
      spread(x - 1, y + 1, (error * 3) / 16);
      spread(x, y + 1, (error * 5) / 16);
      spread(x + 1, y + 1, error / 16);
      const i = index * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** The logo as the printer burns it, by its print mode. */
export function logoToMonochrome(raster: Raster, mode: LogoPrintMode): Raster {
  return mode === "dither" ? ditherToMonochrome(raster) : toMonochrome(raster);
}

/** A logo ready for a receipt template: a 1-bit PNG at its size in dots. */
export interface ReceiptLogo {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Scales an image to its size on the receipt and turns it 1-bit by `mode`, as a PNG data URL the
 * receipt template shows at exactly that size. Browser only (it decodes and draws on a canvas).
 */
export async function prepareReceiptLogo(image: Blob, mode: LogoPrintMode): Promise<ReceiptLogo> {
  const bitmap = await createImageBitmap(image);
  try {
    const size = fitLogo(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2D canvas context");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size.width, size.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const drawn = context.getImageData(0, 0, size.width, size.height);
    return {
      src: rasterToPngUrl(logoToMonochrome(drawn, mode)),
      width: size.width,
      height: size.height,
    };
  } finally {
    bitmap.close();
  }
}
