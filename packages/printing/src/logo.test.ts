import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ditherToMonochrome, fitLogo, logoToMonochrome, RECEIPT_LOGO_BOX } from "./logo.ts";
import { type Raster, toMonochrome } from "./raster.ts";

/** A raster of one grey (0 black … 255 white), opaque. */
function grey(width: number, height: number, level: number): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = level;
    data[i + 1] = level;
    data[i + 2] = level;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

/** The share of black dots in a 1-bit raster. */
function blackShare(raster: Raster): number {
  let black = 0;
  for (let i = 0; i < raster.data.length; i += 4) if (raster.data[i] === 0) black += 1;
  return black / (raster.width * raster.height);
}

function isOneBit(raster: Raster): boolean {
  for (let i = 0; i < raster.data.length; i += 4) {
    const value = raster.data[i];
    if (value !== 0 && value !== 255) return false;
    if (raster.data[i + 1] !== value || raster.data[i + 2] !== value) return false;
    if (raster.data[i + 3] !== 255) return false;
  }
  return true;
}

describe("printing a logo", () => {
  it("keeps a grey as a matching share of black dots when dithered, not all or nothing", () => {
    for (const level of [32, 64, 128, 192, 224]) {
      const dithered = ditherToMonochrome(grey(64, 64, level));
      expect(isOneBit(dithered)).toBe(true);
      expect(blackShare(dithered)).toBeCloseTo(1 - level / 255, 1);
    }
    // By threshold, a light grey is all paper and a dark one all ink.
    expect(blackShare(logoToMonochrome(grey(16, 16, 150), "threshold"))).toBe(0);
    expect(blackShare(logoToMonochrome(grey(16, 16, 100), "threshold"))).toBe(1);
  });

  it("leaves pure black and white as they are in either mode", () => {
    for (const mode of ["threshold", "dither"] as const) {
      expect(blackShare(logoToMonochrome(grey(8, 8, 0), mode))).toBe(1);
      expect(blackShare(logoToMonochrome(grey(8, 8, 255), mode))).toBe(0);
    }
  });

  it("gives a 1-bit image the receipt's threshold leaves unchanged", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        fc.uint8Array({ minLength: 12 * 12 * 4, maxLength: 12 * 12 * 4 }),
        (width, height, bytes) => {
          const raster = {
            width,
            height,
            data: new Uint8ClampedArray(bytes.subarray(0, width * height * 4)),
          };
          const dithered = ditherToMonochrome(raster);
          expect(isOneBit(dithered)).toBe(true);
          expect(toMonochrome(dithered).data).toEqual(dithered.data);
        },
      ),
    );
  });

  it("counts transparent pixels as paper", () => {
    const clear = { width: 4, height: 4, data: new Uint8ClampedArray(64) };
    expect(blackShare(ditherToMonochrome(clear))).toBe(0);
  });

  it("fits the logo in its box, keeping its proportions and an even width", () => {
    expect(fitLogo(512, 512)).toEqual({ width: 160, height: 160 });
    expect(fitLogo(512, 128)).toEqual({ width: 360, height: 90 });
    // A small logo is enlarged at most twice.
    expect(fitLogo(40, 20)).toEqual({ width: 80, height: 40 });
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4000 }), fc.integer({ min: 1, max: 4000 }), (w, h) => {
        const size = fitLogo(w, h);
        expect(size.width % 2).toBe(0);
        expect(size.width).toBeLessThanOrEqual(RECEIPT_LOGO_BOX.width);
        expect(size.height).toBeLessThanOrEqual(RECEIPT_LOGO_BOX.height);
        expect(size.height).toBeGreaterThanOrEqual(1);
      }),
    );
  });
});
