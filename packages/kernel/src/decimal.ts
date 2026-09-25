// The named export: under `nodenext` the package's types read as CommonJS, so its default
// import would type as the module namespace.
import { Decimal as DecimalJs } from "decimal.js";

/**
 * Exact decimal arithmetic for money, prices, quantities, and rates (ADR-0018).
 *
 * `plus`, `minus`, and `times` are exact. Nothing rounds implicitly: rounding happens only
 * through `roundToScale`, `roundToIncrement`, and `dividedBy`, each with an explicit mode.
 * Values never pass through a JavaScript `number`: construction takes canonical strings or
 * bigints, and numeric coercion (`+d`, `d * 2`, `d > e`) throws.
 */

/** Significant digits kept by arithmetic; any result that reaches it is refused, not rounded. */
const PRECISION = 1000;

const Big = DecimalJs.clone({
  precision: PRECISION,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});

/**
 * - `halfAwayFromZero`: to the nearest; ties away from zero (ADR-0018's mode, so a reversal
 *   rounds to the exact negation of the original).
 * - `towardZero`: truncate.
 * - `floor`: toward negative infinity.
 * - `ceiling`: toward positive infinity.
 */
export type RoundingMode = "halfAwayFromZero" | "towardZero" | "floor" | "ceiling";

const ROUNDING: Record<RoundingMode, DecimalJs.Rounding> = {
  halfAwayFromZero: Big.ROUND_HALF_UP,
  towardZero: Big.ROUND_DOWN,
  floor: Big.ROUND_FLOOR,
  ceiling: Big.ROUND_CEIL,
};

/** Canonical decimal text: optional minus, no leading zeros, optional fraction, no exponent. */
const CANONICAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;

export class DecimalFormatError extends Error {
  override name = "DecimalFormatError";
}

export class DecimalPrecisionError extends Error {
  override name = "DecimalPrecisionError";
}

function assertScale(scale: number): void {
  if (!Number.isSafeInteger(scale) || scale < 0) {
    throw new RangeError(`Scale must be a non-negative integer, got ${String(scale)}`);
  }
}

function powerOfTen(exponent: number): DecimalJs {
  return new Big(`1e${String(exponent)}`);
}

export class Decimal {
  static readonly ZERO = new Decimal(new Big(0));
  static readonly ONE = new Decimal(new Big(1));

  readonly #value: DecimalJs;

  private constructor(value: DecimalJs) {
    if (!value.isFinite()) throw new DecimalFormatError("Decimal must be finite");
    if (value.sd(true) >= PRECISION) {
      throw new DecimalPrecisionError(`Decimal exceeds ${String(PRECISION)} significant digits`);
    }
    // decimal.js keeps a negative zero; a reversal of zero must be the same zero.
    this.#value = value.isZero() ? new Big(0) : value;
  }

  /**
   * Builds a decimal from canonical text (`"1250.50"`, `"-0.5"`, `"12"`) or an integer bigint.
   * Rejects exponents, a leading `+` or `.`, leading zeros, whitespace, and numbers.
   */
  static of(value: string | bigint): Decimal {
    if (typeof value === "bigint") return new Decimal(new Big(value.toString()));
    if (typeof value !== "string") {
      throw new TypeError("Decimal takes a canonical string or a bigint, never a number");
    }
    if (!CANONICAL.test(value)) throw new DecimalFormatError(`Not a canonical decimal: "${value}"`);
    return new Decimal(new Big(value));
  }

  /** The decimal `value × 10^-scale` — reads scaled integers (SQLite storage, ADR-0018). */
  static fromScaledInteger(value: bigint, scale: number): Decimal {
    assertScale(scale);
    return new Decimal(new Big(value.toString()).div(powerOfTen(scale)));
  }

  static sum(values: Iterable<Decimal>): Decimal {
    let total = Decimal.ZERO;
    for (const value of values) total = total.plus(value);
    return total;
  }

  plus(other: Decimal): Decimal {
    this.#assertExactSum(other);
    return new Decimal(this.#value.plus(other.#value));
  }

  minus(other: Decimal): Decimal {
    this.#assertExactSum(other);
    return new Decimal(this.#value.minus(other.#value));
  }

  times(other: Decimal): Decimal {
    // A product of m- and n-digit coefficients has at most m + n digits.
    Decimal.#assertFits(this.#value.sd(false) + other.#value.sd(false));
    return new Decimal(this.#value.times(other.#value));
  }

  negated(): Decimal {
    return new Decimal(this.#value.negated());
  }

  abs(): Decimal {
    return new Decimal(this.#value.abs());
  }

  /** Rounds to `scale` decimal places. */
  roundToScale(scale: number, mode: RoundingMode): Decimal {
    assertScale(scale);
    return new Decimal(this.#value.toDecimalPlaces(scale, ROUNDING[mode]));
  }

  /** Rounds to a multiple of `increment` (a cash-rounding step such as `5` or `0.05`). */
  roundToIncrement(increment: Decimal, mode: RoundingMode): Decimal {
    if (!increment.isPositive()) throw new RangeError("Rounding increment must be positive");
    return new Decimal(this.#value.toNearest(increment.#value, ROUNDING[mode]));
  }

  /** The quotient rounded to `scale` decimal places — division never returns an unrounded value. */
  dividedBy(divisor: Decimal, scale: number, mode: RoundingMode): Decimal {
    assertScale(scale);
    if (divisor.isZero()) throw new RangeError("Division by zero");
    const shift = powerOfTen(scale);
    // a / d = (±a) / |d|; with a positive divisor, floor and ceiling of the multiple below are
    // floor and ceiling of the quotient.
    const dividend = divisor.isNegative() ? this.#value.negated() : this.#value;
    const magnitude = divisor.#value.abs();
    // round(a / d × 10^s) = round(a × 10^s ÷ d), taken exactly as the nearest multiple of d.
    const multiple = dividend.times(shift).toNearest(magnitude, ROUNDING[mode]);
    return new Decimal(multiple.div(magnitude).div(shift));
  }

  compare(other: Decimal): -1 | 0 | 1 {
    return this.#value.comparedTo(other.#value) as -1 | 0 | 1;
  }

  equals(other: Decimal): boolean {
    return this.#value.equals(other.#value);
  }

  lessThan(other: Decimal): boolean {
    return this.#value.lessThan(other.#value);
  }

  lessThanOrEqual(other: Decimal): boolean {
    return this.#value.lessThanOrEqualTo(other.#value);
  }

  greaterThan(other: Decimal): boolean {
    return this.#value.greaterThan(other.#value);
  }

  greaterThanOrEqual(other: Decimal): boolean {
    return this.#value.greaterThanOrEqualTo(other.#value);
  }

  sign(): -1 | 0 | 1 {
    return this.isZero() ? 0 : this.#value.isNegative() ? -1 : 1;
  }

  isZero(): boolean {
    return this.#value.isZero();
  }

  isNegative(): boolean {
    return this.sign() === -1;
  }

  isPositive(): boolean {
    return this.sign() === 1;
  }

  isInteger(): boolean {
    return this.#value.isInteger();
  }

  /** Decimal places needed to write the value exactly (`"1.50"` → 1). */
  scale(): number {
    return this.#value.decimalPlaces();
  }

  /** The shortest canonical text, e.g. `"1250.5"`. */
  toString(): string {
    return this.#value.toString();
  }

  /** Canonical text with exactly `scale` decimal places, e.g. `"1250.50"`. Never rounds. */
  toStringAtScale(scale: number): string {
    const text = this.#atScale(scale).toString();
    if (scale === 0) return text;
    const [whole, fraction = ""] = text.split(".");
    return `${whole ?? text}.${fraction.padEnd(scale, "0")}`;
  }

  /** The integer `value × 10^scale`, exact — writes scaled integers (SQLite storage, ADR-0018). */
  toScaledInteger(scale: number): bigint {
    // Exponent notation is disabled, so an integer prints as plain digits.
    return BigInt(this.#atScale(scale).times(powerOfTen(scale)).toString());
  }

  toJSON(): string {
    return this.toString();
  }

  /** Text only on an explicit string conversion; `+d`, `d * 2`, `d > e`, `d == 1.5` throw. */
  [Symbol.toPrimitive](hint: string): string {
    if (hint !== "string") {
      throw new TypeError("A Decimal never converts to a number; use its methods");
    }
    return this.toString();
  }

  /**
   * decimal.js rounds any result longer than its precision, so exactness is checked before
   * the operation, from the digits the result can need — never after.
   */
  static #assertFits(digits: number): void {
    if (digits >= PRECISION) {
      throw new DecimalPrecisionError(
        `The exact result needs up to ${String(digits)} significant digits; the limit is ${String(PRECISION)}`,
      );
    }
  }

  #assertExactSum(other: Decimal): void {
    // From the highest integer digit (plus a carry) down to the lowest fraction digit.
    const highest = Math.max(this.#value.e, other.#value.e, 0) + 2;
    Decimal.#assertFits(highest + Math.max(this.scale(), other.scale()));
  }

  #atScale(scale: number): DecimalJs {
    assertScale(scale);
    if (this.scale() > scale) {
      throw new DecimalPrecisionError(
        `${this.toString()} has more than ${String(scale)} decimal places; round it first`,
      );
    }
    return this.#value;
  }
}
