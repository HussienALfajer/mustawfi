import { Decimal, type RoundingMode } from "./decimal.ts";

/**
 * A currency as the ledger uses it: its ISO 4217 code and its minor units. Minor units come
 * from `core.currency` data, never from code (ADR-0018).
 */
export class Currency {
  readonly code: string;
  readonly minorUnits: number;

  private constructor(code: string, minorUnits: number) {
    this.code = code;
    this.minorUnits = minorUnits;
  }

  static of(code: string, minorUnits: number): Currency {
    if (!/^[A-Z]{3}$/.test(code)) throw new RangeError(`Not an ISO 4217 code: "${code}"`);
    if (!Number.isSafeInteger(minorUnits) || minorUnits < 0 || minorUnits > 4) {
      // Ledger amounts are numeric(20,4): at most four minor-unit digits fit.
      throw new RangeError(`Minor units must be an integer from 0 to 4, got ${String(minorUnits)}`);
    }
    return new Currency(code, minorUnits);
  }

  equals(other: Currency): boolean {
    return this.code === other.code && this.minorUnits === other.minorUnits;
  }

  toString(): string {
    return this.code;
  }
}

export class CurrencyMismatchError extends Error {
  override name = "CurrencyMismatchError";

  constructor(expected: Currency, actual: Currency) {
    super(
      `Expected ${expected.code}/${String(expected.minorUnits)}, got ${actual.code}/${String(actual.minorUnits)}`,
    );
  }
}

/**
 * An exact amount in one currency. Unit prices and costs may carry more decimals than the
 * currency's minor unit; a value becomes a document or ledger amount only through
 * `roundToMinorUnit`, `roundToIncrement`, or `allocate` (ADR-0018's named rounding points).
 */
export class Money {
  readonly amount: Decimal;
  readonly currency: Currency;

  private constructor(amount: Decimal, currency: Currency) {
    this.amount = amount;
    this.currency = currency;
  }

  static of(amount: Decimal | string, currency: Currency): Money {
    return new Money(typeof amount === "string" ? Decimal.of(amount) : amount, currency);
  }

  static zero(currency: Currency): Money {
    return new Money(Decimal.ZERO, currency);
  }

  /** The exact sum; `currency` is the currency of every term and of an empty sum. */
  static sum(values: Iterable<Money>, currency: Currency): Money {
    let total = Money.zero(currency);
    for (const value of values) total = total.plus(value);
    return total;
  }

  plus(other: Money): Money {
    this.#assertSameCurrency(other);
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  minus(other: Money): Money {
    this.#assertSameCurrency(other);
    return new Money(this.amount.minus(other.amount), this.currency);
  }

  /** The exact product, e.g. a unit price times a quantity — round it to make a line amount. */
  times(factor: Decimal): Money {
    return new Money(this.amount.times(factor), this.currency);
  }

  negated(): Money {
    return new Money(this.amount.negated(), this.currency);
  }

  abs(): Money {
    return new Money(this.amount.abs(), this.currency);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative();
  }

  isPositive(): boolean {
    return this.amount.isPositive();
  }

  compare(other: Money): -1 | 0 | 1 {
    this.#assertSameCurrency(other);
    return this.amount.compare(other.amount);
  }

  equals(other: Money): boolean {
    return this.currency.equals(other.currency) && this.amount.equals(other.amount);
  }

  /** Whether the amount is already at the currency's minor unit (a valid ledger amount). */
  isAtMinorUnit(): boolean {
    return this.amount.scale() <= this.currency.minorUnits;
  }

  /** Named rounding point: a line amount, or a line's amount when it is posted. */
  roundToMinorUnit(mode: RoundingMode): Money {
    return new Money(this.amount.roundToScale(this.currency.minorUnits, mode), this.currency);
  }

  /**
   * Named rounding point: cash rounding of a payable total to the payment currency's step.
   * The step must be a whole number of minor units, so the result is still a ledger amount.
   * The difference to the unrounded total belongs on its own cash-rounding line.
   */
  roundToIncrement(increment: Decimal, mode: RoundingMode): Money {
    if (increment.scale() > this.currency.minorUnits) {
      throw new RangeError(
        `Rounding increment ${increment.toString()} is finer than ${this.currency.code}'s minor unit`,
      );
    }
    return new Money(this.amount.roundToIncrement(increment, mode), this.currency);
  }

  /**
   * Splits this amount in proportion to `weights` with largest-remainder allocation: every
   * part is at the minor unit, the parts sum exactly to this amount, each part is within one
   * minor unit of its exact share, and a zero weight gets zero. Ties in the remainder go to
   * the earlier part. Splitting the negation gives the negated parts.
   */
  allocate(weights: readonly Decimal[]): Money[] {
    if (!this.isAtMinorUnit()) {
      throw new RangeError(
        `Allocate an amount at ${this.currency.code}'s minor unit; round it first`,
      );
    }
    if (weights.length === 0) throw new RangeError("Allocation needs at least one weight");
    if (weights.some((weight) => weight.isNegative())) {
      throw new RangeError("Allocation weights must not be negative");
    }
    const weightScale = Math.max(...weights.map((weight) => weight.scale()));
    const units = weights.map((weight) => weight.toScaledInteger(weightScale));
    const unitTotal = units.reduce((sum, unit) => sum + unit, 0n);
    if (unitTotal === 0n) throw new RangeError("Allocation weights must not all be zero");

    const minorUnits = this.currency.minorUnits;
    const total = this.amount.toScaledInteger(minorUnits);
    const magnitude = total < 0n ? -total : total;
    const parts = units.map((unit) => (magnitude * unit) / unitTotal);
    const remainders = units.map((unit) => (magnitude * unit) % unitTotal);
    let leftover = magnitude - parts.reduce((sum, part) => sum + part, 0n);
    const order = remainders
      .map((remainder, index) => ({ remainder, index }))
      .sort((a, b) =>
        a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
      );
    for (const { index } of order) {
      if (leftover === 0n) break;
      parts[index] = (parts[index] ?? 0n) + 1n;
      leftover -= 1n;
    }
    return parts.map(
      (part) =>
        new Money(Decimal.fromScaledInteger(total < 0n ? -part : part, minorUnits), this.currency),
    );
  }

  /** `"1250.50 USD"` — for logs and messages; the UI formats through `packages/i18n`. */
  toString(): string {
    return `${this.#amountText()} ${this.currency.code}`;
  }

  toJSON(): { amount: string; currency: string } {
    return { amount: this.#amountText(), currency: this.currency.code };
  }

  [Symbol.toPrimitive](hint: string): string {
    if (hint !== "string") throw new TypeError("Money never converts to a number; use its methods");
    return this.toString();
  }

  #amountText(): string {
    return this.amount.toStringAtScale(Math.max(this.amount.scale(), this.currency.minorUnits));
  }

  #assertSameCurrency(other: Money): void {
    if (!this.currency.equals(other.currency)) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
