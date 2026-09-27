import { LOGO_MAX_BYTES, logoTypeOf } from "../../shared/index.ts";

/**
 * The owner chooses the logo as it comes — a phone photo, a designer's PNG — up to 5 MB; the
 * client reduces it before saving (`core-foundation` slice 21): at most `LOGO_MAX_SIDE` pixels on
 * its longer side, re-encoded until it fits the stored limit (`LOGO_MAX_BYTES`). A receipt prints
 * it at most 360 dots wide, so 512 pixels keep it sharp on paper and on screen.
 */
export const LOGO_CHOSEN_MAX_BYTES = 5 * 1024 * 1024;
export const LOGO_MAX_SIDE = 512;

/** What the file chooser offers; WebP is read and saved as PNG or JPEG. */
export const LOGO_CHOSEN_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** Why a chosen image could not become a logo. */
export class LogoReductionError extends Error {
  readonly problem: "logoTooLarge" | "logoType" | "logoUnreadable";

  constructor(problem: LogoReductionError["problem"], options?: ErrorOptions) {
    super(`the logo could not be reduced: ${problem}`, options);
    this.name = "LogoReductionError";
    this.problem = problem;
  }
}

/** A decoded image, as the codec drew it. */
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
}

/** How images are decoded and encoded: the browser's canvas, or a fake in tests. */
export interface LogoCodec<I extends DecodedImage> {
  decode(image: Blob): Promise<I>;
  /** `image` drawn at `width × height`, encoded as `type` (JPEG on white, at `quality`). */
  encode(
    image: I,
    width: number,
    height: number,
    type: "image/png" | "image/jpeg",
    quality?: number,
  ): Promise<Blob>;
  release?(image: I): void;
}

/**
 * The logo's size once reduced: its proportions, the longer side at most `maxSide` (whole
 * pixels, rounded down).
 */
export function logoTargetSize(
  width: number,
  height: number,
  maxSide = LOGO_MAX_SIDE,
): { readonly width: number; readonly height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

/** JPEG qualities tried in turn once a PNG does not fit; then the image shrinks and tries again. */
const JPEG_QUALITIES = [0.92, 0.85, 0.75, 0.6] as const;
const SHRINK = 0.75;
const MAX_ROUNDS = 6;

/**
 * Reduces a chosen image to a logo the server takes — one that already fits (PNG or JPEG, at
 * most 512 px, under 256 KB) as it is; otherwise PNG first (sharp edges, transparency), then
 * JPEG at falling qualities, then the same at three quarters of the size, until one fits under
 * `LOGO_MAX_BYTES`. Refuses a file over `LOGO_CHOSEN_MAX_BYTES`, of another type, or unreadable.
 */
export async function reduceLogo<I extends DecodedImage>(
  file: Blob,
  codec: LogoCodec<I>,
): Promise<Uint8Array> {
  if (file.size > LOGO_CHOSEN_MAX_BYTES) throw new LogoReductionError("logoTooLarge");
  // A type the browser does not know is left to the decoder: Windows reports none for WebP
  // without its codec registered.
  if (file.type !== "" && !(LOGO_CHOSEN_TYPES as readonly string[]).includes(file.type)) {
    throw new LogoReductionError("logoType");
  }
  let image: I;
  try {
    image = await codec.decode(file);
  } catch (error) {
    throw new LogoReductionError("logoUnreadable", { cause: error });
  }
  try {
    // A PNG or JPEG that already fits is kept as it is: re-encoding it would only lose quality.
    if (file.size <= LOGO_MAX_BYTES && Math.max(image.width, image.height) <= LOGO_MAX_SIDE) {
      const original = new Uint8Array(await file.arrayBuffer());
      if (logoTypeOf(original) !== undefined) return original;
    }
    let size = logoTargetSize(image.width, image.height);
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const png = await codec.encode(image, size.width, size.height, "image/png");
      if (png.size <= LOGO_MAX_BYTES) return new Uint8Array(await png.arrayBuffer());
      for (const quality of JPEG_QUALITIES) {
        const jpeg = await codec.encode(image, size.width, size.height, "image/jpeg", quality);
        if (jpeg.size <= LOGO_MAX_BYTES) return new Uint8Array(await jpeg.arrayBuffer());
      }
      size = logoTargetSize(size.width * SHRINK, size.height * SHRINK, Number.POSITIVE_INFINITY);
    }
    throw new LogoReductionError("logoTooLarge");
  } finally {
    codec.release?.(image);
  }
}

/** The browser's codec: `createImageBitmap` to decode, a canvas to draw and encode. */
export const canvasLogoCodec: LogoCodec<ImageBitmap> = {
  decode: (image) => createImageBitmap(image),
  encode(image, width, height, type, quality) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) return Promise.reject(new Error("no 2D canvas context"));
    // JPEG has no transparency: what was clear becomes the receipt's white, not black.
    if (type === "image/jpeg") {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob === null) reject(new Error(`the canvas did not encode ${type}`));
          else resolve(blob);
        },
        type,
        quality,
      );
    });
  },
  release: (image) => {
    image.close();
  },
};
