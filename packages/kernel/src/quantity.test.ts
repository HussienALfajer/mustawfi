import { describe, expect, it } from "vitest";
import { Quantity, UnitMismatchError } from "./quantity.ts";

describe("Quantity", () => {
  it("adds and compares within one unit, exactly", () => {
    const total = Quantity.of("0.1", "kg").plus(Quantity.of("0.2", "kg"));
    expect(total.equals(Quantity.of("0.3", "kg"))).toBe(true);
    expect(total.minus(Quantity.of("0.5", "kg")).isNegative()).toBe(true);
    expect(Quantity.of("2", "piece").compare(Quantity.of("10", "piece"))).toBe(-1);
    expect(Quantity.of("1", "piece").negated().toString()).toBe("-1 piece");
    expect(JSON.stringify(Quantity.of("1.50", "kg"))).toBe('{"amount":"1.5","unit":"kg"}');
  });

  it("refuses mixed units and blank units", () => {
    expect(() => Quantity.of("1", "kg").plus(Quantity.of("1", "piece"))).toThrow(UnitMismatchError);
    expect(() => Quantity.of("1", " ")).toThrow(RangeError);
    expect(() => Quantity.of("1", "kg ")).toThrow(RangeError);
  });

  it("never coerces to a number", () => {
    expect(() => +(Quantity.of("1", "kg") as unknown as number)).toThrow(TypeError);
  });
});
