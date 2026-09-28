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

/** The catalog of `core.currency` as the kernel sees it: USD, then TRY, then SYP (ADR-0031). */
const RANKED = {
  USD: Currency.of("USD", 2, 1),
  TRY: Currency.of("TRY", 2, 2),
  SYP: Currency.of("SYP", 2, 3),
} as const;
type RankedCode = keyof typeof RANKED;

/** A catalog rate: at most 12 whole digits and 6 decimals (ADR-0018 amendment). */
const catalogRate = fc
  .tuple(fc.bigInt({ min: 1n, max: 10n ** 18n - 1n }), fc.integer({ min: 0, max: 6 }))
  .map(([value, scale]) => Decimal.fromScaledInteger(value, scale))
  .filter((rate) => rate.lessThan(Decimal.of("1000000000000")));

/** The rate of `foreign` against `base`, quoted per 1 unit of the stronger of the two. */
const quoted = (base: Currency, foreign: Currency, rate: Decimal) => {
  const baseIsStronger = (base.strengthRank ?? 0) < (foreign.strengthRank ?? 0);
  return ExchangeRate.of({
    unitCurrency: baseIsStronger ? base : foreign,
    quoteCurrency: baseIsStronger ? foreign : base,
    rate,
  });
};

describe("ExchangeRate quote direction (ADR-0031)", () => {
  it("quotes the weaker currency per 1 unit of the stronger and refuses the inverse", () => {
    expect(
      ExchangeRate.of({
        unitCurrency: RANKED.USD,
        quoteCurrency: RANKED.SYP,
        rate: "13000",
      }).rate.toString(),
    ).toBe("13000");
    expect(
      ExchangeRate.of({
        unitCurrency: RANKED.TRY,
        quoteCurrency: RANKED.SYP,
        rate: "300",
      }).rate.toString(),
    ).toBe("300");
    expect(
      ExchangeRate.of({
        unitCurrency: RANKED.USD,
        quoteCurrency: RANKED.TRY,
        rate: "43",
      }).rate.toString(),
    ).toBe("43");
    expect(() =>
      ExchangeRate.of({ unitCurrency: RANKED.SYP, quoteCurrency: RANKED.USD, rate: "0.000077" }),
    ).toThrow(/stronger currency/);
    expect(() =>
      ExchangeRate.of({ unitCurrency: RANKED.SYP, quoteCurrency: RANKED.TRY, rate: "0.003" }),
    ).toThrow(/stronger currency/);
    expect(() =>
      ExchangeRate.of({ unitCurrency: RANKED.TRY, quoteCurrency: RANKED.USD, rate: "0.02" }),
    ).toThrow(/stronger currency/);
  });

  it("does not order a currency outside the catalog", () => {
    expect(() =>
      ExchangeRate.of({ unitCurrency: SYP, quoteCurrency: RANKED.USD, rate: "0.5" }),
    ).not.toThrow();
  });

  test.prop([
    fc.constantFrom<RankedCode>("USD", "TRY", "SYP"),
    fc.constantFrom<RankedCode>("USD", "TRY", "SYP"),
    catalogRate,
  ])(
    "builds a catalog pair exactly when the unit currency is the stronger",
    (unit, quote, rate) => {
      fc.pre(unit !== quote);
      const build = () =>
        ExchangeRate.of({ unitCurrency: RANKED[unit], quoteCurrency: RANKED[quote], rate });
      const stronger = (RANKED[unit].strengthRank ?? 0) < (RANKED[quote].strengthRank ?? 0);
      if (stronger) expect(build().rate.equals(rate)).toBe(true);
      else expect(build).toThrow(RangeError);
    },
  );
});

describe("ExchangeRate.crossConvert (ADR-0031)", () => {
  const sypBase = {
    usd: quoted(RANKED.SYP, RANKED.USD, d("13000")),
    try: quoted(RANKED.SYP, RANKED.TRY, d("300")),
  };
  const usdBase = {
    syp: quoted(RANKED.USD, RANKED.SYP, d("13000")),
    try: quoted(RANKED.USD, RANKED.TRY, d("43")),
  };

  it("converts between two foreign currencies through the base rates", () => {
    const toTry = ExchangeRate.crossConvert(
      Money.of("100", RANKED.USD),
      { from: sypBase.usd, to: sypBase.try },
      "halfAwayFromZero",
    );
    expect(toTry.toString()).toBe("4333.33 TRY");
    const toUsd = ExchangeRate.crossConvert(
      Money.of("4333.33", RANKED.TRY),
      { from: sypBase.try, to: sypBase.usd },
      "halfAwayFromZero",
    );
    expect(toUsd.toString()).toBe("100.00 USD");
  });

  it("rounds once, never through the base", () => {
    // 100 SYP at 13,000 SYP per USD and 43 TRY per USD: exactly 0.3307… TRY. Rounding through
    // the base first would give 0.01 USD, then 0.43 TRY.
    const converted = ExchangeRate.crossConvert(
      Money.of("100", RANKED.SYP),
      { from: usdBase.syp, to: usdBase.try },
      "halfAwayFromZero",
    );
    expect(converted.toString()).toBe("0.33 TRY");
    const throughBase = usdBase.try.convert(
      usdBase.syp.convert(Money.of("100", RANKED.SYP), "halfAwayFromZero"),
      "halfAwayFromZero",
    );
    expect(throughBase.toString()).toBe("0.43 TRY");
  });

  it("refuses rates that share no base and a conversion to the same currency", () => {
    expect(() =>
      ExchangeRate.crossConvert(
        Money.of("1", RANKED.USD),
        { from: sypBase.usd, to: usdBase.try },
        "halfAwayFromZero",
      ),
    ).toThrow(RangeError);
    expect(() =>
      ExchangeRate.crossConvert(
        Money.of("1", RANKED.USD),
        { from: sypBase.usd, to: sypBase.usd },
        "halfAwayFromZero",
      ),
    ).toThrow(RangeError);
    expect(() =>
      ExchangeRate.crossConvert(
        Money.of("1", RANKED.TRY),
        { from: sypBase.usd, to: sypBase.try },
        "halfAwayFromZero",
      ),
    ).toThrow(CurrencyMismatchError);
  });

  /** A base currency, two foreign currencies of the catalog, their rates, and an amount. */
  const crossCase = fc
    .record({
      base: fc.constantFrom<RankedCode>("SYP", "USD"),
      fromRate: catalogRate,
      toRate: catalogRate,
      swap: fc.boolean(),
    })
    .chain(({ base, fromRate, toRate, swap }) => {
      const foreign = (["USD", "TRY", "SYP"] as const).filter((code) => code !== base);
      const [source, target] = swap ? [foreign[1], foreign[0]] : [foreign[0], foreign[1]];
      if (source === undefined || target === undefined) throw new Error("two foreign currencies");
      const from = quoted(RANKED[base], RANKED[source], fromRate);
      const to = quoted(RANKED[base], RANKED[target], toRate);
      return fc.tuple(
        fc.constant({ from, to, source: RANKED[source], target: RANKED[target] }),
        ledgerMoney(RANKED[source]),
      );
    });

  test.prop([crossCase])(
    "is within half a minor unit of the exact value",
    ([{ from, to, source, target }, money]) => {
      const converted = ExchangeRate.crossConvert(money, { from, to }, "halfAwayFromZero");
      expect(converted.currency.equals(target)).toBe(true);
      expect(converted.isAtMinorUnit()).toBe(true);
      // exact = amount × p ÷ q: money → base multiplies when the source is the unit of its pair;
      // base → target multiplies when the target is the quote of its pair.
      const p = (source.equals(from.unitCurrency) ? from.rate : Decimal.ONE).times(
        target.equals(to.quoteCurrency) ? to.rate : Decimal.ONE,
      );
      const q = (source.equals(from.unitCurrency) ? Decimal.ONE : from.rate).times(
        target.equals(to.quoteCurrency) ? Decimal.ONE : to.rate,
      );
      // |c − a·p/q| ≤ ½ minor unit  ⇔  |c·q − a·p| ≤ ½ minor unit × q
      const residual = converted.amount.times(q).minus(money.amount.times(p)).abs();
      expect(residual.lessThanOrEqual(halfMinorUnit(target).times(q))).toBe(true);
    },
  );

  test.prop([crossCase])("converting a reversal mirrors the original", ([{ from, to }, money]) => {
    const converted = ExchangeRate.crossConvert(money, { from, to }, "halfAwayFromZero");
    const negated = ExchangeRate.crossConvert(money.negated(), { from, to }, "halfAwayFromZero");
    expect(negated.equals(converted.negated())).toBe(true);
  });
});
