import { describe, expect, it } from "vitest";
import { decimalString } from "./wire.ts";

describe("decimalString", () => {
  const price = decimalString({ scale: 6, sign: "nonNegative" });

  it.each(["0", "1250.5", "1250.500000", "99999999999999.999999"])("accepts %s", (text) => {
    expect(price.safeParse(text).success).toBe(true);
  });

  it.each([
    ["a number", 1250.5],
    ["an exponent", "1e3"],
    ["a leading plus", "+1"],
    ["a leading zero", "01"],
    ["a bare point", ".5"],
    ["whitespace", " 1"],
    ["a comma", "1,5"],
    ["too many decimals", "1.0000001"],
    ["too many integer digits for numeric(20,6)", "100000000000000"],
    ["a negative", "-1"],
  ])("refuses %s", (_, value) => {
    expect(price.safeParse(value).success).toBe(false);
  });

  it("keeps signs apart", () => {
    const positive = decimalString({ scale: 4, sign: "positive" });
    expect(positive.safeParse("0").success).toBe(false);
    expect(positive.safeParse("0.0001").success).toBe(true);
    const signed = decimalString({ scale: 4 });
    expect(signed.safeParse("-12.5").success).toBe(true);
  });

  it("refuses a precision that leaves no integer digits", () => {
    expect(() => decimalString({ scale: 6, precision: 6 })).toThrow(RangeError);
  });
});
