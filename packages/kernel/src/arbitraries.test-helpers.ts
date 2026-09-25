import { fc } from "@fast-check/vitest";
import { Decimal } from "./decimal.ts";
import { Currency, Money } from "./money.ts";

/** Any decimal up to 24 integer-and-fraction digits, at scale 0–8. */
export const decimal = (options: { maxScale?: number } = {}): fc.Arbitrary<Decimal> =>
  fc
    .tuple(
      fc.bigInt({ min: -(10n ** 24n), max: 10n ** 24n }),
      fc.integer({ min: 0, max: options.maxScale ?? 8 }),
    )
    .map(([value, scale]) => Decimal.fromScaledInteger(value, scale));

/**
 * A value exactly halfway between two multiples of 10^-scale — random decimals almost never
 * land on a tie, and ties are where rounding modes differ.
 */
export const tie = (scale: number): fc.Arbitrary<Decimal> =>
  fc
    .bigInt({ min: -(10n ** 18n), max: 10n ** 18n })
    .map((units) => Decimal.fromScaledInteger(units * 10n + (units < 0n ? -5n : 5n), scale + 1));

/** A decimal, or a tie at `scale` one time in three. */
export const decimalOrTie = (scale: number): fc.Arbitrary<Decimal> =>
  fc.oneof({ weight: 2, arbitrary: decimal() }, { weight: 1, arbitrary: tie(scale) });

/** A positive decimal at scale 0–`maxScale`, up to 10^18. */
export const positiveDecimal = (maxScale: number): fc.Arbitrary<Decimal> =>
  fc
    .tuple(fc.bigInt({ min: 1n, max: 10n ** 18n }), fc.integer({ min: 0, max: maxScale }))
    .map(([value, scale]) => Decimal.fromScaledInteger(value, scale));

export const currency = fc
  .tuple(fc.constantFrom("USD", "SYP", "EUR", "KWD", "JPY"), fc.integer({ min: 0, max: 4 }))
  .map(([code, minorUnits]) => Currency.of(code, minorUnits));

/** Money already at its currency's minor unit, as a ledger amount is. */
export const ledgerMoney = (of: Currency): fc.Arbitrary<Money> =>
  fc
    .bigInt({ min: -(10n ** 16n), max: 10n ** 16n })
    .map((units) => Money.of(Decimal.fromScaledInteger(units, of.minorUnits), of));

export const roundingMode = fc.constantFrom("halfAwayFromZero", "towardZero", "floor", "ceiling");
