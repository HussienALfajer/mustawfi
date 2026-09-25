import { describe, expect, it } from "vitest";
import { isPinAllowed, pinSchema } from "./pin.ts";

/** Every string of `length` digits. */
function* allPins(length: number): Generator<string> {
  for (let n = 0; n < 10 ** length; n += 1) yield String(n).padStart(length, "0");
}

describe("PIN rules (core-foundation rule 19)", () => {
  it("allows 4–6 digits and nothing else", () => {
    for (const pin of ["2580", "13579", "902731"]) expect(isPinAllowed(pin)).toBe(true);
    for (const pin of ["", "258", "2580135", "25a0", "٢٥٨٠", " 2580", "2580 ", "25.0"]) {
      expect(isPinAllowed(pin), pin).toBe(false);
    }
  });

  it("refuses exactly the repeated digits and the straight runs up or down, at every length", () => {
    for (const length of [4, 5, 6]) {
      const refused = [...allPins(length)].filter((pin) => !isPinAllowed(pin));
      const expected: string[] = [];
      for (let d = 0; d <= 9; d += 1) expected.push(String(d).repeat(length));
      for (let start = 0; start + length - 1 <= 9; start += 1) {
        const up = Array.from({ length }, (_, i) => String(start + i)).join("");
        expected.push(up, [...up].reverse().join(""));
      }
      expect(refused.sort()).toEqual(expected.sort());
    }
  });

  it("does not wrap a run past 9 or 0, and allows near misses", () => {
    for (const pin of ["7890", "8901", "1233", "1235", "2468", "1122", "0987"]) {
      expect(isPinAllowed(pin), pin).toBe(true);
    }
    expect(isPinAllowed("3210")).toBe(false);
    expect(isPinAllowed("6789")).toBe(false);
  });

  it("is what pinSchema checks", () => {
    expect(pinSchema.safeParse("2580").success).toBe(true);
    expect(pinSchema.safeParse("1234").success).toBe(false);
    expect(pinSchema.safeParse(1234).success).toBe(false);
  });
});
