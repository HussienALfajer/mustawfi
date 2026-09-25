import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { currency, ledgerMoney, positiveDecimal } from "./arbitraries.test-helpers.ts";
import { Decimal } from "./decimal.ts";
import { Currency, CurrencyMismatchError, Money } from "./money.ts";

const USD = Currency.of("USD", 2);
const SYP = Currency.of("SYP", 2);
const d = (text: string) => Decimal.of(text);

/** A currency with ledger amounts in it and weights to split them by. */
const allocationCase = currency.chain((of) =>
  fc.record({
    total: ledgerMoney(of),
    weights: fc.array(
      fc.oneof(
        { weight: 1, arbitrary: fc.constant(Decimal.ZERO) },
        { weight: 4, arbitrary: positiveDecimal(4) },
      ),
      { minLength: 1, maxLength: 12 },
    ),
  }),
);

describe("Currency", () => {
  it("validates code and minor units", () => {
    expect(Currency.of("USD", 2).equals(USD)).toBe(true);
    expect(Currency.of("USD", 3).equals(USD)).toBe(false);
    for (const [code, minorUnits] of [
      ["usd", 2],
      ["US", 2],
      ["USD", -1],
      ["USD", 5],
      ["USD", 1.5],
    ] as const) {
      expect(() => Currency.of(code, minorUnits)).toThrow(RangeError);
    }
  });
});

describe("Money", () => {
  it("adds only the same currency, exactly", () => {
    expect(Money.of("0.10", USD).plus(Money.of("0.20", USD)).equals(Money.of("0.3", USD))).toBe(
      true,
    );
    expect(() => Money.of("1", USD).plus(Money.of("1", SYP))).toThrow(CurrencyMismatchError);
    expect(() => Money.of("1", USD).plus(Money.of("1", Currency.of("USD", 3)))).toThrow(
      CurrencyMismatchError,
    );
    expect(() => Money.of("1", USD).compare(Money.of("1", SYP))).toThrow(CurrencyMismatchError);
    expect(Money.sum([], SYP).equals(Money.zero(SYP))).toBe(true);
    expect(Money.sum([Money.of("1.25", SYP), Money.of("2.5", SYP)], SYP).toString()).toBe(
      "3.75 SYP",
    );
  });

  it("makes a line amount only by rounding the exact product (named point 1)", () => {
    const unitPrice = Money.of("1.333333", USD);
    const exact = unitPrice.times(d("3"));
    expect(exact.amount.toString()).toBe("3.999999");
    expect(exact.isAtMinorUnit()).toBe(false);
    const line = exact.roundToMinorUnit("halfAwayFromZero");
    expect(line.toString()).toBe("4.00 USD");
    expect(line.isAtMinorUnit()).toBe(true);
  });

  it("serializes amounts as canonical strings at least at the minor unit", () => {
    expect(JSON.stringify(Money.of("1250.5", USD))).toBe('{"amount":"1250.50","currency":"USD"}');
    expect(Money.of("1.333333", USD).toJSON().amount).toBe("1.333333");
    expect(() => +(Money.of("1", USD) as unknown as number)).toThrow(TypeError);
  });

  test.prop([
    currency.chain((of) => fc.tuple(ledgerMoney(of), fc.constantFrom("0.05", "1", "5", "50"))),
  ])(
    "cash rounding: total plus the rounding line equals the payable, and a reversal mirrors it (named point 3)",
    ([total, step]) => {
      const increment = d(step);
      fc.pre(increment.scale() <= total.currency.minorUnits);
      const payable = total.roundToIncrement(increment, "halfAwayFromZero");
      const roundingLine = payable.minus(total);
      expect(total.plus(roundingLine).equals(payable)).toBe(true);
      expect(payable.isAtMinorUnit()).toBe(true);
      expect(roundingLine.amount.abs().times(d("2")).lessThanOrEqual(increment)).toBe(true);
      expect(
        total.negated().roundToIncrement(increment, "halfAwayFromZero").equals(payable.negated()),
      ).toBe(true);
    },
  );

  it("refuses a cash step finer than the minor unit", () => {
    expect(() =>
      Money.of("1", Currency.of("JPY", 0)).roundToIncrement(d("0.5"), "halfAwayFromZero"),
    ).toThrow(RangeError);
  });
});

describe("Money.allocate (largest remainder)", () => {
  it("splits 100.00 in three", () => {
    const parts = Money.of("100", USD).allocate([d("1"), d("1"), d("1")]);
    expect(parts.map(String)).toEqual(["33.34 USD", "33.33 USD", "33.33 USD"]);
  });

  it("splits by uneven weights and gives a zero weight nothing", () => {
    const parts = Money.of("10.00", SYP).allocate([d("0.3"), d("0"), d("0.7"), d("0.5")]);
    expect(parts.map((part) => part.amount.toString())).toEqual(["2", "0", "4.67", "3.33"]);
  });

  test.prop([allocationCase])(
    "parts are at the minor unit and sum exactly to the whole",
    ({ total, weights }) => {
      fc.pre(weights.some((weight) => !weight.isZero()));
      const parts = total.allocate(weights);
      expect(parts).toHaveLength(weights.length);
      expect(parts.every((part) => part.isAtMinorUnit())).toBe(true);
      expect(Money.sum(parts, total.currency).equals(total)).toBe(true);
    },
  );

  test.prop([allocationCase])(
    "each part is within one minor unit of its exact share; a zero weight gets zero",
    ({ total, weights }) => {
      fc.pre(weights.some((weight) => !weight.isZero()));
      const parts = total.allocate(weights);
      const weightTotal = Decimal.sum(weights);
      const minorUnit = Decimal.fromScaledInteger(1n, total.currency.minorUnits);
      parts.forEach((part, index) => {
        const weight = weights[index] ?? Decimal.ZERO;
        // |part − total × w / W| < 1 minor unit  ⇔  |part × W − total × w| < W × minor unit
        const error = part.amount.times(weightTotal).minus(total.amount.times(weight)).abs();
        expect(error.lessThan(weightTotal.times(minorUnit))).toBe(true);
        if (weight.isZero()) expect(part.isZero()).toBe(true);
      });
    },
  );

  test.prop([allocationCase])(
    "allocating the reversal gives the reversed parts",
    ({ total, weights }) => {
      fc.pre(weights.some((weight) => !weight.isZero()));
      const reversed = total.negated().allocate(weights);
      total.allocate(weights).forEach((part, index) => {
        expect(reversed[index]?.equals(part.negated())).toBe(true);
      });
    },
  );

  it("refuses amounts off the minor unit and invalid weights", () => {
    expect(() => Money.of("1.005", USD).allocate([d("1")])).toThrow(RangeError);
    expect(() => Money.of("1", USD).allocate([])).toThrow(RangeError);
    expect(() => Money.of("1", USD).allocate([d("0"), d("0")])).toThrow(RangeError);
    expect(() => Money.of("1", USD).allocate([d("1"), d("-1")])).toThrow(RangeError);
  });
});
