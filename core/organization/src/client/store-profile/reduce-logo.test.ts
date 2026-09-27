import { describe, expect, it } from "vitest";
import { LOGO_MAX_BYTES } from "../../shared/index.ts";
import {
  type DecodedImage,
  LOGO_CHOSEN_MAX_BYTES,
  type LogoCodec,
  LogoReductionError,
  logoTargetSize,
  reduceLogo,
} from "./reduce-logo.ts";

interface Encoding {
  readonly width: number;
  readonly height: number;
  readonly type: string;
  readonly quality: number | undefined;
}

/**
 * A codec whose encoded size is a function of the pixels and the format: a PNG costs `png`
 * bytes per pixel, a JPEG `jpeg × quality`. Records what it was asked.
 */
function fakeCodec(image: DecodedImage, cost: { png: number; jpeg: number }) {
  const encodings: Encoding[] = [];
  let released = false;
  const codec: LogoCodec<DecodedImage> = {
    decode: () => Promise.resolve(image),
    encode(_image, width, height, type, quality) {
      encodings.push({ width, height, type, quality });
      const perPixel = type === "image/png" ? cost.png : cost.jpeg * (quality ?? 1);
      return Promise.resolve(new Blob([new Uint8Array(Math.ceil(width * height * perPixel))]));
    },
    release: () => {
      released = true;
    },
  };
  return { codec, encodings, released: () => released };
}

const file = (size: number, type = "image/png") => new Blob([new Uint8Array(size)], { type });

describe("reducing a chosen logo", () => {
  it("keeps the proportions with the longer side at most 512 pixels, never enlarging", () => {
    expect(logoTargetSize(2048, 1024)).toEqual({ width: 512, height: 256 });
    expect(logoTargetSize(600, 1200)).toEqual({ width: 256, height: 512 });
    expect(logoTargetSize(300, 100)).toEqual({ width: 300, height: 100 });
  });

  it("saves a PNG when one fits, at the reduced size", async () => {
    const fake = fakeCodec({ width: 3000, height: 1500 }, { png: 0.5, jpeg: 0.3 });
    const bytes = await reduceLogo(file(4_000_000), fake.codec);
    expect(fake.encodings).toEqual([
      { width: 512, height: 256, type: "image/png", quality: undefined },
    ]);
    expect(bytes.length).toBe(512 * 256 * 0.5);
    expect(fake.released()).toBe(true);
  });

  it("falls back to JPEG at falling qualities, then to a smaller size, until it fits", async () => {
    // 512 × 512 PNG: 786 KB; JPEG at 0.92: 434 KB, …, at 0.6: 283 KB — none fits at 512 px.
    const fake = fakeCodec({ width: 1024, height: 1024 }, { png: 3, jpeg: 1.8 });
    const bytes = await reduceLogo(file(1_000_000, "image/jpeg"), fake.codec);
    expect(bytes.length).toBeLessThanOrEqual(LOGO_MAX_BYTES);
    expect(fake.encodings.slice(0, 5).map((e) => [e.type, e.quality])).toEqual([
      ["image/png", undefined],
      ["image/jpeg", 0.92],
      ["image/jpeg", 0.85],
      ["image/jpeg", 0.75],
      ["image/jpeg", 0.6],
    ]);
    const last = fake.encodings.at(-1);
    expect(last).toMatchObject({ width: 384, height: 384, type: "image/jpeg" });
  });

  it("refuses a file over 5 MB, of another type, or that does not decode", async () => {
    const fake = fakeCodec({ width: 10, height: 10 }, { png: 1, jpeg: 1 });
    await expect(reduceLogo(file(LOGO_CHOSEN_MAX_BYTES + 1), fake.codec)).rejects.toMatchObject({
      problem: "logoTooLarge",
    });
    await expect(reduceLogo(file(10, "image/gif"), fake.codec)).rejects.toMatchObject({
      problem: "logoType",
    });
    const broken: LogoCodec<DecodedImage> = {
      ...fake.codec,
      decode: () => Promise.reject(new Error("not an image")),
    };
    await expect(reduceLogo(file(10), broken)).rejects.toBeInstanceOf(LogoReductionError);
    await expect(reduceLogo(file(10), broken)).rejects.toMatchObject({ problem: "logoUnreadable" });
    expect(fake.encodings).toEqual([]);
  });

  it("keeps a PNG or JPEG that already fits as it is", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const fake = fakeCodec({ width: 400, height: 200 }, { png: 1, jpeg: 1 });
    const bytes = await reduceLogo(new Blob([jpeg], { type: "image/jpeg" }), fake.codec);
    expect(bytes).toEqual(jpeg);
    expect(fake.encodings).toEqual([]);
    // Too wide, or a WebP (not stored as such), is re-encoded.
    const wide = fakeCodec({ width: 800, height: 200 }, { png: 1, jpeg: 1 });
    await reduceLogo(new Blob([jpeg], { type: "image/jpeg" }), wide.codec);
    expect(wide.encodings).toHaveLength(1);
  });

  it("leaves a file the browser gives no type to the decoder", async () => {
    const fake = fakeCodec({ width: 1024, height: 512 }, { png: 0.1, jpeg: 0.1 });
    await expect(reduceLogo(file(1000, ""), fake.codec)).resolves.toHaveLength(
      Math.ceil(512 * 256 * 0.1),
    );
  });

  it("gives up when nothing fits, however small", async () => {
    const fake = fakeCodec({ width: 512, height: 512 }, { png: 20, jpeg: 40 });
    await expect(reduceLogo(file(10), fake.codec)).rejects.toMatchObject({
      problem: "logoTooLarge",
    });
    expect(fake.released()).toBe(true);
  });
});
