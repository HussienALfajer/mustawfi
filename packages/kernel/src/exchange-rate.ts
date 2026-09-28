import { Decimal, type RoundingMode } from "./decimal.ts";
import { type Currency, CurrencyMismatchError, Money } from "./money.ts";

/** Exchange rates are stored as `numeric(20,6)` (ADR-0018). */
export const EXCHANGE_RATE_SCALE = 6;

/**
 * A rate quoted as units of `quoteCurrency` per 1 unit of `unitCurrency` — for the SYP/USD
 * pair always SYP per 1 USD, whatever the tenant's base currency. Never stored inverted:
 * converting the other way divides (ADR-0018). Between two catalog currencies (both carry a
 * strength rank) the unit currency is the stronger one (ADR-0031); an inverted pair is refused.
 */
export class ExchangeRate {
  readonly quoteCurrency: Currency;
  readonly unitCurrency: Currency;
  readonly rate: Decimal;

  private constructor(quoteCurrency: Currency, unitCurrency: Currency, rate: Decimal) {
    this.quoteCurrency = quoteCurrency;
    this.unitCurrency = unitCurrency;
    this.rate = rate;
  }

  static of(input: {
    quoteCurrency: Currency;
    unitCurrency: Currency;
    rate: Decimal | string;
  }): ExchangeRate {
    const rate = typeof input.rate === "string" ? Decimal.of(input.rate) : input.rate;
    const { quoteCurrency, unitCurrency } = input;
    if (quoteCurrency.code === unitCurrency.code) {
      throw new RangeError("An exchange rate needs two different currencies");
    }
    if (
      quoteCurrency.strengthRank !== undefined &&
      unitCurrency.strengthRank !== undefined &&
      unitCurrency.strengthRank >= quoteCurrency.strengthRank
    ) {
      throw new RangeError(
        `A rate is quoted per 1 unit of the stronger currency: ${unitCurrency.code} per 1 ${quoteCurrency.code}, not the inverse`,
      );
    }
    if (!rate.isPositive()) throw new RangeError("An exchange rate must be positive");
    if (rate.scale() > EXCHANGE_RATE_SCALE) {
      throw new RangeError(
        `An exchange rate has at most ${String(EXCHANGE_RATE_SCALE)} decimal places, got ${rate.toString()}`,
      );
    }
    return new ExchangeRate(quoteCurrency, unitCurrency, rate);
  }

  /** Whether `currency` is one of the pair's two currencies. */
  involves(currency: Currency): boolean {
    return currency.equals(this.unitCurrency) || currency.equals(this.quoteCurrency);
  }

  /** The pair's currency that is not `currency`; throws when `currency` is not in the pair. */
  otherThan(currency: Currency): Currency {
    if (currency.equals(this.unitCurrency)) return this.quoteCurrency;
    if (currency.equals(this.quoteCurrency)) return this.unitCurrency;
    throw new CurrencyMismatchError(this.unitCurrency, currency);
  }

  /**
   * Named rounding point: converts to the other currency of the pair, rounded to the target
   * currency's minor unit. The result is within half a minor unit of the exact value.
   */
  convert(money: Money, mode: RoundingMode): Money {
    if (money.currency.equals(this.unitCurrency)) {
      return Money.of(money.amount.times(this.rate), this.quoteCurrency).roundToMinorUnit(mode);
    }
    if (money.currency.equals(this.quoteCurrency)) {
      const amount = money.amount.dividedBy(this.rate, this.unitCurrency.minorUnits, mode);
      return Money.of(amount, this.unitCurrency);
    }
    throw new CurrencyMismatchError(this.unitCurrency, money.currency);
  }

  /**
   * Named rounding point 2 between two foreign currencies (ADR-0031): converts `money` through
   * the base currency the two rates share — `from` pairs the base with `money`'s currency, `to`
   * pairs it with the target — multiplying and dividing exactly and rounding once, to the
   * target's minor unit. Never two roundings through the base. The result is within half a
   * minor unit of the exact value.
   */
  static crossConvert(
    money: Money,
    rates: { readonly from: ExchangeRate; readonly to: ExchangeRate },
    mode: RoundingMode,
  ): Money {
    const { from, to } = rates;
    const base = from.otherThan(money.currency);
    if (!to.involves(base)) {
      throw new RangeError(
        `The rates share no base currency: ${from.unitCurrency.code}/${from.quoteCurrency.code} and ${to.unitCurrency.code}/${to.quoteCurrency.code}`,
      );
    }
    const target = to.otherThan(base);
    if (target.equals(money.currency)) {
      throw new RangeError(`Converting ${target.code} to itself needs no rate`);
    }
    // money → base: × rate when money is the unit, ÷ rate when it is the quote; base → target:
    // ÷ rate when the target is the unit, × rate when it is the quote. One fraction, one rounding.
    let numerator = money.amount;
    let denominator = Decimal.ONE;
    if (money.currency.equals(from.unitCurrency)) numerator = numerator.times(from.rate);
    else denominator = denominator.times(from.rate);
    if (target.equals(to.quoteCurrency)) numerator = numerator.times(to.rate);
    else denominator = denominator.times(to.rate);
    return Money.of(numerator.dividedBy(denominator, target.minorUnits, mode), target);
  }
}
