import { describe, expect, it } from "vitest";
import { encodeReceipt } from "./escpos.ts";
import { PAPER_DOTS, type Raster, toMonochrome } from "./raster.ts";

function white(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}

function paint(raster: Raster, x: number, y: number, rgba: readonly number[]): void {
  raster.data.set(rgba, (y * raster.width + x) * 4);
}

/** Every `GS v 0` command in the bytes: its width in bytes, rows, and row data. */
function rasterCommands(bytes: Uint8Array) {
  const found: { widthBytes: number; rows: number; data: Uint8Array }[] = [];
  for (let i = 0; i + 8 <= bytes.length; i += 1) {
    if (bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30 && bytes[i + 3] === 0) {
      const widthBytes = (bytes[i + 4] ?? 0) + (bytes[i + 5] ?? 0) * 256;
      const rows = (bytes[i + 6] ?? 0) + (bytes[i + 7] ?? 0) * 256;
      const data = bytes.subarray(i + 8, i + 8 + widthBytes * rows);
      found.push({ widthBytes, rows, data });
      i += 7 + data.length;
    }
  }
  return found;
}

function indexOfSequence(bytes: Uint8Array, sequence: readonly number[]): number {
  outer: for (let i = 0; i + sequence.length <= bytes.length; i += 1) {
    for (let j = 0; j < sequence.length; j += 1) if (bytes[i + j] !== sequence[j]) continue outer;
    return i;
  }
  return -1;
}

describe("toMonochrome", () => {
  it("turns each pixel black or white by luminance, transparent as paper", () => {
    const raster = white(4, 1);
    paint(raster, 0, 0, [0, 0, 0, 255]);
    paint(raster, 1, 0, [200, 200, 200, 255]);
    paint(raster, 2, 0, [100, 100, 100, 255]);
    paint(raster, 3, 0, [0, 0, 0, 0]);
    const mono = toMonochrome(raster);
    expect(Array.from(mono.data)).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255,
    ]);
    expect(Array.from(toMonochrome(mono).data)).toEqual(Array.from(mono.data));
  });
});

describe("encodeReceipt", () => {
  it("prints the 576-dot raster one pixel per dot, in chunks of at most 255 rows", () => {
    const height = 600;
    const raster = white(PAPER_DOTS.mm80, height);
    // Corners and one dot in the middle: their bits must land exactly there.
    const dots: [number, number][] = [
      [0, 0],
      [575, 0],
      [0, 599],
      [575, 599],
      [300, 256],
    ];
    for (const [x, y] of dots) paint(raster, x, y, [0, 0, 0, 255]);

    const commands = rasterCommands(encodeReceipt(raster, { cut: false, openDrawer: false }));

    expect(commands.map((command) => command.rows)).toEqual([255, 255, 90]);
    expect(commands.every((command) => command.widthBytes === 72)).toBe(true);
    const rows = commands.flatMap((command) =>
      Array.from({ length: command.rows }, (_, row) =>
        command.data.subarray(row * 72, (row + 1) * 72),
      ),
    );
    const black: [number, number][] = [];
    rows.forEach((row, y) => {
      row.forEach((byte, column) => {
        for (let bit = 0; bit < 8; bit += 1) {
          if ((byte >> (7 - bit)) & 1) black.push([column * 8 + bit, y]);
        }
      });
    });
    expect(black.sort((a, b) => a[1] - b[1] || a[0] - b[0])).toEqual(
      [...dots].sort((a, b) => a[1] - b[1] || a[0] - b[0]),
    );
  });

  it("initializes, kicks the drawer before the image, and cuts after it", () => {
    const raster = white(PAPER_DOTS.mm80, 8);
    const bytes = encodeReceipt(raster, { cut: true, openDrawer: true });
    const initialize = indexOfSequence(bytes, [0x1b, 0x40]);
    const kick = indexOfSequence(bytes, [0x1b, 0x70, 0x00]);
    const image = indexOfSequence(bytes, [0x1d, 0x76, 0x30, 0x00]);
    const cut = indexOfSequence(bytes, [0x1d, 0x56, 0x01]);
    expect(initialize).toBe(0);
    expect(kick).toBeGreaterThan(initialize);
    expect(image).toBeGreaterThan(kick);
    expect(cut).toBeGreaterThan(image);
  });

  it("sends no drawer kick and no cut unless asked", () => {
    const bytes = encodeReceipt(white(PAPER_DOTS.mm58, 8), { cut: false, openDrawer: false });
    expect(indexOfSequence(bytes, [0x1b, 0x70])).toBe(-1);
    expect(indexOfSequence(bytes, [0x1d, 0x56])).toBe(-1);
    expect(rasterCommands(bytes)[0]?.widthBytes).toBe(48);
  });

  it("refuses a raster that is not a whole number of bytes wide", () => {
    expect(() => encodeReceipt(white(570, 8), { cut: true, openDrawer: false })).toThrow();
  });
});
