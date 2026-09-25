import { Decimal } from "./decimal.ts";

export class UnitMismatchError extends Error {
  override name = "UnitMismatchError";
}

/** An exact quantity in one unit (`piece`, `kg`, `carton`). Unit conversion belongs to inventory. */
export class Quantity {
  readonly amount: Decimal;
  readonly unit: string;

  private constructor(amount: Decimal, unit: string) {
    this.amount = amount;
    this.unit = unit;
  }

  static of(amount: Decimal | string, unit: string): Quantity {
    if (unit.trim() === "" || unit.trim() !== unit) {
      throw new RangeError(`Not a unit: "${unit}"`);
    }
    return new Quantity(typeof amount === "string" ? Decimal.of(amount) : amount, unit);
  }

  plus(other: Quantity): Quantity {
    this.#assertSameUnit(other);
    return new Quantity(this.amount.plus(other.amount), this.unit);
  }

  minus(other: Quantity): Quantity {
    this.#assertSameUnit(other);
    return new Quantity(this.amount.minus(other.amount), this.unit);
  }

  negated(): Quantity {
    return new Quantity(this.amount.negated(), this.unit);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative();
  }

  compare(other: Quantity): -1 | 0 | 1 {
    this.#assertSameUnit(other);
    return this.amount.compare(other.amount);
  }

  equals(other: Quantity): boolean {
    return this.unit === other.unit && this.amount.equals(other.amount);
  }

  toString(): string {
    return `${this.amount.toString()} ${this.unit}`;
  }

  toJSON(): { amount: string; unit: string } {
    return { amount: this.amount.toString(), unit: this.unit };
  }

  [Symbol.toPrimitive](hint: string): string {
    if (hint !== "string") {
      throw new TypeError("A Quantity never converts to a number; use its methods");
    }
    return this.toString();
  }

  #assertSameUnit(other: Quantity): void {
    if (this.unit !== other.unit) {
      throw new UnitMismatchError(`Expected ${this.unit}, got ${other.unit}`);
    }
  }
}
