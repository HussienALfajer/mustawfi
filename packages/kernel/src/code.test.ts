import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { randomCode, randomIndex, UNAMBIGUOUS_ALPHABET } from "./code.ts";
import { type RandomSource, seededRandom } from "./random.ts";

/** Replays the given bytes, then repeats the last one. */
function replay(...bytes: number[]): RandomSource {
  let position = 0;
  return {
    bytes: (length) =>
      Uint8Array.from({ length }, () => bytes[Math.min(position++, bytes.length - 1)] ?? 0),
  };
}

describe("randomCode", () => {
  it("uses 32 symbols without I, O, 0, or 1", () => {
    expect(new Set(UNAMBIGUOUS_ALPHABET).size).toBe(32);
    expect(UNAMBIGUOUS_ALPHABET).not.toMatch(/[IO01]/);
  });

  it("maps each byte to one symbol by its low five bits", () => {
    expect(randomCode(replay(0, 31, 32, 255), 4)).toBe("A9A9");
  });

  test.prop([fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 1, max: 40 })])(
    "gives `length` symbols of the alphabet",
    (seed, length) => {
      const code = randomCode(seededRandom(seed), length);
      expect(code).toHaveLength(length);
      for (const symbol of code) expect(UNAMBIGUOUS_ALPHABET).toContain(symbol);
    },
  );

  it("refuses an empty code", () => {
    expect(() => randomCode(seededRandom(1), 0)).toThrow(RangeError);
  });
});

describe("randomIndex", () => {
  test.prop([fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 1, max: 0x1_0000 })])(
    "stays in [0, bound)",
    (seed, bound) => {
      const index = randomIndex(seededRandom(seed), bound);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(bound);
    },
  );

  it("rejects the biased tail and draws again", () => {
    // bound 3: 65535 is past the last whole multiple of 3 (65535 = 3 × 21845), so it is redrawn.
    expect(randomIndex(replay(0xff, 0xff, 0x00, 0x04), 3)).toBe(1);
  });

  it("refuses a bound outside 1..65536", () => {
    expect(() => randomIndex(seededRandom(1), 0)).toThrow(RangeError);
    expect(() => randomIndex(seededRandom(1), 0x1_0001)).toThrow(RangeError);
  });
});
