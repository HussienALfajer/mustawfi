import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { manualClock, systemClock } from "./clock.ts";
import { isUuidV7, uuidV7Generator, uuidV7Timestamp } from "./id.ts";
import { cryptoRandom, type RandomSource, seededRandom } from "./random.ts";

const START = new Date("2026-09-25T08:00:00.000Z");

describe("Clock", () => {
  it("a manual clock moves only when told to", () => {
    const clock = manualClock(START);
    expect(clock.now().toISOString()).toBe("2026-09-25T08:00:00.000Z");
    clock.advance(1500);
    expect(clock.now().toISOString()).toBe("2026-09-25T08:00:01.500Z");
    clock.set(new Date("2026-01-01T00:00:00.000Z"));
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(() => clock.advance(0.5)).toThrow(RangeError);
  });

  it("returns a fresh Date each time", () => {
    const clock = manualClock(START);
    clock.now().setTime(0);
    expect(clock.now().getTime()).toBe(START.getTime());
  });

  it("the system clock reads the real time", () => {
    const first = systemClock.now();
    expect(first).toBeInstanceOf(Date);
    expect(systemClock.now().getTime()).toBeGreaterThanOrEqual(first.getTime());
  });
});

describe("RandomSource", () => {
  it("a seeded source is deterministic per seed", () => {
    expect(seededRandom(42).bytes(16)).toEqual(seededRandom(42).bytes(16));
    expect(seededRandom(42).bytes(16)).not.toEqual(seededRandom(43).bytes(16));
    expect(seededRandom(1).bytes(7)).toHaveLength(7);
  });

  it("the crypto source returns the requested length", () => {
    expect(cryptoRandom.bytes(10)).toHaveLength(10);
    expect(cryptoRandom.bytes(16)).not.toEqual(cryptoRandom.bytes(16));
  });
});

describe("UUIDv7", () => {
  it("encodes version, variant, and the clock's milliseconds", () => {
    const id = uuidV7Generator({ clock: manualClock(START), random: cryptoRandom })();
    expect(isUuidV7(id)).toBe(true);
    expect(id[14]).toBe("7");
    expect("89ab").toContain(id[19]);
    expect(uuidV7Timestamp(id)).toBe(START.getTime());
  });

  it("rejects other UUID versions and non-canonical text", () => {
    expect(isUuidV7("0192f0c1-8d6e-4b7a-9c1d-2e3f4a5b6c7d")).toBe(false);
    expect(isUuidV7("0192F0C1-8D6E-7B7A-9C1D-2E3F4A5B6C7D")).toBe(false);
    expect(isUuidV7("0192f0c1-8d6e-7b7a-cc1d-2e3f4a5b6c7d")).toBe(false);
    expect(isUuidV7("0192f0c1-8d6e-7b7a-9c1d-2e3f4a5b6c7d")).toBe(true);
  });

  test.prop([
    fc.integer(),
    fc.array(fc.integer({ min: -5, max: 5 }), { minLength: 1, maxLength: 300 }),
  ])(
    "ids from one generator are unique and sort strictly in creation order, even when the clock stalls or steps back",
    (seed, steps) => {
      const clock = manualClock(START);
      const next = uuidV7Generator({ clock, random: seededRandom(seed) });
      const ids = steps.map((step) => {
        clock.advance(step);
        return next();
      });
      expect(ids.every((id) => isUuidV7(id))).toBe(true);
      expect([...ids].sort()).toEqual(ids);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  it("keeps room for the counter even when the random bits are all ones", () => {
    const maxed: RandomSource = { bytes: (length) => new Uint8Array(length).fill(0xff) };
    const next = uuidV7Generator({ clock: manualClock(START), random: maxed });
    const ids = Array.from({ length: 200 }, () => next());
    expect(ids.every((id) => isUuidV7(id) && uuidV7Timestamp(id) === START.getTime())).toBe(true);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("refuses a clock before 1970", () => {
    const next = uuidV7Generator({
      clock: manualClock(new Date("1969-12-31T23:59:59.000Z")),
      random: cryptoRandom,
    });
    expect(() => next()).toThrow(RangeError);
  });
});
