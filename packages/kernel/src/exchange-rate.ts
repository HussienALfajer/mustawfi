import { Decimal, type RoundingMode } from "./decimal.ts";
import { type Currency, CurrencyMismatchError, Money } from "./money.ts";

/** Exchange rates are stored as `numeric(20,6)` (ADR-0018). */
export const EXCHANGE_RATE_SCALE = 6;

/**
 * A rate quoted as units of `quoteCurrency` per 1 unit of `unitCurrency` — for the SYP/USD
 * pair always SYP per 1 USD, whatever the tenant's base currency. Never stored inverted:
 * converting the other way divides (ADR-0018).
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
    if (input.quoteCurrency.code === input.unitCurrency.code) {
      throw new RangeError("An exchange rate needs two different currencies");
    }
    if (!rate.isPositive()) throw new RangeError("An exchange rate must be positive");
    if (rate.scale() > EXCHANGE_RATE_SCALE) {
      throw new RangeError(
        `An exchange rate has at most ${String(EXCHANGE_RATE_SCALE)} decimal places, got ${rate.toString()}`,
      );
    }
    return new ExchangeRate(input.quoteCurrency, input.unitCurrency, rate);
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
}
