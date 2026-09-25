import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { ledgerMoney, positiveDecimal } from "./arbitraries.test-helpers.ts";
import { Decimal } from "./decimal.ts";
import { ExchangeRate } from "./exchange-rate.ts";
import { Currency, CurrencyMismatchError, Money } from "./money.ts";

const USD = Currency.of("USD", 2);
const SYP = Currency.of("SYP", 2);
const EUR = Currency.of("EUR", 2);
const d = (text: string) => Decimal.of(text);

const sypPerUsd = (rate: string) =>
  ExchangeRate.of({ quoteCurrency: SYP, unitCurrency: USD, rate });

/** A rate of scale ≤ 6 between two currencies with any minor units. */
const rateCase = fc
  .record({
    quoteMinorUnits: fc.integer({ min: 0, max: 4 }),
    unitMinorUnits: fc.integer({ min: 0, max: 4 }),
    rate: positiveDecimal(6),
  })
  .map(({ quoteMinorUnits, unitMinorUnits, rate }) =>
    ExchangeRate.of({
      quoteCurrency: Currency.of("SYP", quoteMinorUnits),
      unitCurrency: Currency.of("USD", unitMinorUnits),
      rate,
    }),
  );

const halfMinorUnit = (of: Currency) => Decimal.fromScaledInteger(5n, of.minorUnits + 1);

describe("ExchangeRate", () => {
  it("is always quoted as SYP per 1 USD and converts both ways (named point 2)", () => {
    const rate = sypPerUsd("11000");
    expect(rate.convert(Money.of("100", USD), "halfAwayFromZero").toString()).toBe(
      "1100000.00 SYP",
    );
    expect(rate.convert(Money.of("12345", SYP), "halfAwayFromZero").toString()).toBe("1.12 USD");
    expect(rate.convert(Money.of("5500", SYP), "halfAwayFromZero").toString()).toBe("0.50 USD");
    expect(rate.convert(Money.of("-5500", SYP), "halfAwayFromZero").toString()).toBe("-0.50 USD");
  });

  it("refuses invalid rates and third currencies", () => {
    expect(() => sypPerUsd("0")).toThrow(RangeError);
    expect(() => sypPerUsd("-11000")).toThrow(RangeError);
    expect(() => sypPerUsd("0.0000001")).toThrow(RangeError);
    expect(() => ExchangeRate.of({ quoteCurrency: USD, unitCurrency: USD, rate: "1" })).toThrow(
      RangeError,
    );
    expect(() => sypPerUsd("11000").convert(Money.of("1", EUR), "halfAwayFromZero")).toThrow(
      CurrencyMismatchError,
    );
  });

  test.prop([
    rateCase.chain((rate) => fc.tuple(fc.constant(rate), ledgerMoney(rate.unitCurrency))),
  ])(
    "unit → quote: the result is within half a minor unit of the exact product",
    ([rate, money]) => {
      const converted = rate.convert(money, "halfAwayFromZero");
      expect(converted.currency.equals(rate.quoteCurrency)).toBe(true);
      expect(converted.isAtMinorUnit()).toBe(true);
      const residual = converted.amount.minus(money.amount.times(rate.rate)).abs();
      expect(residual.lessThanOrEqual(halfMinorUnit(rate.quoteCurrency))).toBe(true);
    },
  );

  test.prop([
    rateCase.chain((rate) => fc.tuple(fc.constant(rate), ledgerMoney(rate.quoteCurrency))),
  ])(
    "quote → unit: the result is within half a minor unit of the exact quotient",
    ([rate, money]) => {
      const converted = rate.convert(money, "halfAwayFromZero");
      expect(converted.currency.equals(rate.unitCurrency)).toBe(true);
      expect(converted.isAtMinorUnit()).toBe(true);
      // |c − m / r| ≤ ½ minor unit  ⇔  |c × r − m| ≤ ½ minor unit × r
      const residual = converted.amount.times(rate.rate).minus(money.amount).abs();
      expect(residual.lessThanOrEqual(halfMinorUnit(rate.unitCurrency).times(rate.rate))).toBe(
        true,
      );
    },
  );

  test.prop([
    rateCase.chain((rate) =>
      fc.tuple(
        fc.constant(rate),
        fc.oneof(ledgerMoney(rate.unitCurrency), ledgerMoney(rate.quoteCurrency)),
      ),
    ),
  ])("converting a reversal mirrors the original conversion", ([rate, money]) => {
    const converted = rate.convert(money, "halfAwayFromZero");
    expect(rate.convert(money.negated(), "halfAwayFromZero").equals(converted.negated())).toBe(
      true,
    );
  });

  test.prop([
    rateCase.chain((rate) =>
      fc.tuple(
        fc.constant(rate),
        fc.array(ledgerMoney(rate.unitCurrency), { minLength: 1, maxLength: 20 }),
      ),
    ),
  ])(
    "converted lines differ from the converted total by at most half a minor unit per conversion",
    ([rate, lines]) => {
      // The bound a posting's rounding line must respect (ADR-0018, named point 4).
      const convertedLines = Money.sum(
        lines.map((line) => rate.convert(line, "halfAwayFromZero")),
        rate.quoteCurrency,
      );
      const convertedTotal = rate.convert(Money.sum(lines, rate.unitCurrency), "halfAwayFromZero");
      const residual = convertedLines.minus(convertedTotal).amount.abs();
      const bound = halfMinorUnit(rate.quoteCurrency).times(Decimal.of(BigInt(lines.length + 1)));
      expect(residual.lessThanOrEqual(bound)).toBe(true);
    },
  );

  it("keeps the rate exact", () => {
    expect(sypPerUsd("11000.125").rate.equals(d("11000.125"))).toBe(true);
  });
});
