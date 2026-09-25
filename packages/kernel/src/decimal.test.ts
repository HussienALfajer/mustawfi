import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import {
  decimal,
  decimalOrTie,
  positiveDecimal,
  roundingMode,
  tie,
} from "./arbitraries.test-helpers.ts";
import {
  Decimal,
  DecimalFormatError,
  DecimalPrecisionError,
  type RoundingMode,
} from "./decimal.ts";

const d = (text: string) => Decimal.of(text);

/** A target scale and a value to round to it — a tie at that scale one time in three. */
const valueAtScale = fc
  .integer({ min: 0, max: 8 })
  .chain((scale) => fc.tuple(decimalOrTie(scale), fc.constant(scale)));

/** Independent oracle: rounds the integer `value / divisor` (divisor > 0) with bigints. */
function roundQuotient(value: bigint, divisor: bigint, mode: RoundingMode): bigint {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  let rounded = quotient;
  if (remainder !== 0n) {
    const up =
      mode === "halfAwayFromZero"
        ? 2n * remainder >= divisor
        : mode === "floor"
          ? negative
          : mode === "ceiling"
            ? !negative
            : false;
    if (up) rounded += 1n;
  }
  return negative ? -rounded : rounded;
}

function roundOracle(x: Decimal, scale: number, mode: RoundingMode): Decimal {
  const own = x.scale();
  if (own <= scale) return x;
  const rounded = roundQuotient(x.toScaledInteger(own), 10n ** BigInt(own - scale), mode);
  return Decimal.fromScaledInteger(rounded, scale);
}

describe("Decimal construction", () => {
  it("accepts canonical text and bigints", () => {
    expect(d("1250.50").toString()).toBe("1250.5");
    expect(d("-0.005").toString()).toBe("-0.005");
    expect(d("0").toString()).toBe("0");
    expect(Decimal.of(123n).toString()).toBe("123");
    expect(d("123456789012345678901234567890.123456").toString()).toBe(
      "123456789012345678901234567890.123456",
    );
  });

  it.each([
    "",
    " 1",
    "1 ",
    "+1",
    ".5",
    "5.",
    "01",
    "-01.5",
    "1e3",
    "1E-2",
    "NaN",
    "Infinity",
    "1,5",
    "--1",
    "٣",
  ])("rejects non-canonical text %j", (text) => {
    expect(() => Decimal.of(text)).toThrow(DecimalFormatError);
  });

  it("refuses numbers at runtime too", () => {
    expect(() => Decimal.of(0.1 as unknown as string)).toThrow(TypeError);
  });

  it("never coerces to a number", () => {
    const value = d("1.5") as unknown as number;
    expect(() => +value).toThrow(TypeError);
    expect(() => value * 2).toThrow(TypeError);
    expect(() => value > 1).toThrow(TypeError);
    expect(() => value == 1.5).toThrow(TypeError);
    expect(() => (value as unknown as string) + "").toThrow(TypeError);
    expect(String(d("1.5"))).toBe("1.5");
    expect(JSON.stringify({ amount: d("1.50") })).toBe('{"amount":"1.5"}');
  });

  it("has a single zero: negation and rounding never give a negative zero", () => {
    expect(d("-0").isNegative()).toBe(false);
    expect(d("-0").toString()).toBe("0");
    expect(Decimal.ZERO.negated().sign()).toBe(0);
    const rounded = d("-0.004").roundToScale(2, "halfAwayFromZero");
    expect(rounded.isNegative()).toBe(false);
    expect(rounded.toString()).toBe("0");
  });

  test.prop([decimal()])("round-trips through canonical text", (x) => {
    expect(Decimal.of(x.toString()).equals(x)).toBe(true);
  });

  test.prop([decimal(), fc.integer({ min: 0, max: 4 })])(
    "round-trips through scaled integers (SQLite storage)",
    (x, extra) => {
      const scale = x.scale() + extra;
      expect(Decimal.fromScaledInteger(x.toScaledInteger(scale), scale).equals(x)).toBe(true);
      expect(Decimal.of(x.toStringAtScale(scale)).equals(x)).toBe(true);
      expect(x.toStringAtScale(scale).split(".")[1]?.length ?? 0).toBe(scale);
    },
  );

  it("writes fixed-scale text and scaled integers without rounding", () => {
    expect(d("1250.5").toStringAtScale(2)).toBe("1250.50");
    expect(d("-3").toStringAtScale(4)).toBe("-3.0000");
    expect(d("7").toStringAtScale(0)).toBe("7");
    expect(d("12.34").toScaledInteger(4)).toBe(123400n);
    expect(() => d("1.005").toStringAtScale(2)).toThrow(DecimalPrecisionError);
    expect(() => d("1.005").toScaledInteger(2)).toThrow(DecimalPrecisionError);
  });
});

describe("Decimal arithmetic is exact", () => {
  test.prop([decimal(), decimal()])("plus and minus match integer arithmetic", (a, b) => {
    const scale = Math.max(a.scale(), b.scale());
    const [x, y] = [a.toScaledInteger(scale), b.toScaledInteger(scale)];
    expect(a.plus(b).toScaledInteger(scale)).toBe(x + y);
    expect(a.minus(b).toScaledInteger(scale)).toBe(x - y);
    expect(a.minus(b).plus(b).equals(a)).toBe(true);
  });

  test.prop([decimal(), decimal()])("times matches integer arithmetic", (a, b) => {
    const product = a.times(b).toScaledInteger(a.scale() + b.scale());
    expect(product).toBe(a.toScaledInteger(a.scale()) * b.toScaledInteger(b.scale()));
  });

  it("0.1 + 0.2 is 0.3", () => {
    expect(d("0.1").plus(d("0.2")).equals(d("0.3"))).toBe(true);
  });

  it("refuses a result it cannot hold exactly instead of rounding it", () => {
    const huge = Decimal.of(10n ** 600n + 1n);
    expect(() => huge.times(huge)).toThrow(DecimalPrecisionError);
    // a long fraction: decimal.js would round the product to 1000 digits without a word
    const fraction = Decimal.fromScaledInteger(10n ** 600n + 1n, 600);
    expect(() => fraction.times(fraction)).toThrow(DecimalPrecisionError);
    const [big, tiny] = [Decimal.of(10n ** 600n), Decimal.fromScaledInteger(1n, 600)];
    expect(() => big.plus(tiny)).toThrow(DecimalPrecisionError);
    expect(() => big.minus(tiny)).toThrow(DecimalPrecisionError);
  });

  it("sums, compares, and signs", () => {
    expect(Decimal.sum([d("1.1"), d("2.2"), d("-0.3")]).toString()).toBe("3");
    expect(Decimal.sum([]).isZero()).toBe(true);
    expect(d("2").compare(d("10"))).toBe(-1);
    expect(d("2.50").equals(d("2.5"))).toBe(true);
    expect(d("-1").lessThan(d("0"))).toBe(true);
    expect(d("1").greaterThanOrEqual(d("1.0"))).toBe(true);
    expect(d("-7").abs().toString()).toBe("7");
    expect([d("-2").sign(), d("0").sign(), d("3").sign()]).toEqual([-1, 0, 1]);
    expect(d("4.00").isInteger()).toBe(true);
    expect(d("1.50").scale()).toBe(1);
  });
});

describe("Decimal rounding happens only through named, mode-explicit functions", () => {
  it("rounds half away from zero", () => {
    const cases: [string, string][] = [
      ["2.5", "3"],
      ["-2.5", "-3"],
      ["2.4999", "2"],
      ["0.5", "1"],
      ["-0.5", "-1"],
      ["1.005", "1.01"],
      ["-1.005", "-1.01"],
    ];
    for (const [input, expected] of cases) {
      const scale = expected.includes(".") ? 2 : 0;
      expect(d(input).roundToScale(scale, "halfAwayFromZero").toString()).toBe(expected);
    }
  });

  it("offers the other modes only by name", () => {
    expect(d("-1.25").roundToScale(1, "towardZero").toString()).toBe("-1.2");
    expect(d("-1.21").roundToScale(1, "floor").toString()).toBe("-1.3");
    expect(d("1.21").roundToScale(1, "ceiling").toString()).toBe("1.3");
  });

  test.prop([valueAtScale, roundingMode])(
    "roundToScale matches the integer oracle, ties included",
    ([x, scale], mode) => {
      expect(x.roundToScale(scale, mode).equals(roundOracle(x, scale, mode))).toBe(true);
    },
  );

  test.prop([
    fc.integer({ min: 0, max: 8 }).chain((scale) => fc.tuple(tie(scale), fc.constant(scale))),
  ])("a tie rounds away from zero", ([x, scale]) => {
    const rounded = x.roundToScale(scale, "halfAwayFromZero");
    expect(rounded.abs().greaterThan(x.abs())).toBe(true);
    expect(rounded.sign()).toBe(x.sign());
  });

  test.prop([valueAtScale])(
    "half away from zero: within half a unit, idempotent, and a reversal mirrors the original",
    ([x, scale]) => {
      const rounded = x.roundToScale(scale, "halfAwayFromZero");
      const halfUnit = Decimal.fromScaledInteger(5n, scale + 1);
      expect(rounded.scale()).toBeLessThanOrEqual(scale);
      expect(rounded.minus(x).abs().lessThanOrEqual(halfUnit)).toBe(true);
      expect(rounded.roundToScale(scale, "halfAwayFromZero").equals(rounded)).toBe(true);
      expect(x.negated().roundToScale(scale, "halfAwayFromZero").equals(rounded.negated())).toBe(
        true,
      );
    },
  );

  test.prop([
    positiveDecimal(2).chain((increment) =>
      fc.tuple(
        // a tie between two multiples of the increment one time in three
        fc.oneof(
          { weight: 2, arbitrary: decimal() },
          { weight: 1, arbitrary: tie(0).map((t) => t.times(increment)) },
        ),
        fc.constant(increment),
      ),
    ),
    roundingMode,
  ])(
    "roundToIncrement gives a multiple of the increment, within one increment",
    ([x, increment], mode) => {
      const rounded = x.roundToIncrement(increment, mode);
      expect(rounded.dividedBy(increment, 0, "towardZero").times(increment).equals(rounded)).toBe(
        true,
      );
      expect(rounded.minus(x).abs().lessThan(increment)).toBe(true);
      if (mode === "halfAwayFromZero") {
        const twiceTheDistance = rounded.minus(x).abs().times(d("2"));
        expect(twiceTheDistance.lessThanOrEqual(increment)).toBe(true);
        // exactly half a step away means x was a tie: it must have gone away from zero
        if (twiceTheDistance.equals(increment)) {
          expect(rounded.abs().greaterThan(x.abs())).toBe(true);
        }
        expect(x.negated().roundToIncrement(increment, mode).equals(rounded.negated())).toBe(true);
      }
      if (mode === "floor") expect(rounded.lessThanOrEqual(x)).toBe(true);
      if (mode === "ceiling") expect(rounded.greaterThanOrEqual(x)).toBe(true);
    },
  );

  it("rounds to cash steps", () => {
    expect(d("1237.50").roundToIncrement(d("5"), "halfAwayFromZero").toString()).toBe("1240");
    expect(d("1237.49").roundToIncrement(d("5"), "halfAwayFromZero").toString()).toBe("1235");
    expect(d("-1237.5").roundToIncrement(d("5"), "halfAwayFromZero").toString()).toBe("-1240");
    expect(d("0.125").roundToIncrement(d("0.05"), "halfAwayFromZero").toString()).toBe("0.15");
    expect(() => d("1").roundToIncrement(d("0"), "halfAwayFromZero")).toThrow(RangeError);
  });

  test.prop([
    fc
      .tuple(
        decimal().filter((x) => !x.isZero()),
        fc.integer({ min: 0, max: 8 }),
      )
      .chain(([b, scale]) =>
        fc.tuple(
          // a quotient that is a tie at the target scale one time in three
          fc.oneof(
            { weight: 2, arbitrary: decimal() },
            { weight: 1, arbitrary: tie(scale).map((t) => t.times(b)) },
          ),
          fc.constant(b),
          fc.constant(scale),
        ),
      ),
    roundingMode,
  ])("dividedBy matches the integer oracle, for either sign of divisor", ([a, b, scale], mode) => {
    // a / b × 10^scale = (A × 10^(sb + scale)) / (B × 10^sa) for scaled integers A and B.
    const [sa, sb] = [a.scale(), b.scale()];
    let numerator = a.toScaledInteger(sa) * 10n ** BigInt(sb + scale);
    let denominator = b.toScaledInteger(sb) * 10n ** BigInt(sa);
    if (denominator < 0n) [numerator, denominator] = [-numerator, -denominator];
    const expected = Decimal.fromScaledInteger(roundQuotient(numerator, denominator, mode), scale);
    expect(a.dividedBy(b, scale, mode).equals(expected)).toBe(true);
  });

  it("divides only with a scale and a mode", () => {
    expect(d("1").dividedBy(d("3"), 4, "halfAwayFromZero").toString()).toBe("0.3333");
    expect(d("2").dividedBy(d("3"), 2, "halfAwayFromZero").toString()).toBe("0.67");
    expect(d("-2").dividedBy(d("3"), 2, "halfAwayFromZero").toString()).toBe("-0.67");
    expect(d("1").dividedBy(d("-3"), 2, "floor").toString()).toBe("-0.34");
    expect(d("1").dividedBy(d("-3"), 2, "ceiling").toString()).toBe("-0.33");
    expect(() => d("1").dividedBy(Decimal.ZERO, 2, "halfAwayFromZero")).toThrow(RangeError);
  });

  it("refuses a scale that is not a non-negative integer", () => {
    for (const scale of [-1, 1.5, Number.NaN]) {
      expect(() => d("1").roundToScale(scale, "halfAwayFromZero")).toThrow(RangeError);
    }
  });
});
