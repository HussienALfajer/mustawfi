import { z } from "zod";
import { Decimal } from "./decimal.ts";

/** Canonical decimal text, as `Decimal.of` reads it. */
const CANONICAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;

export interface DecimalStringOptions {
  /** Most decimal places allowed: the column's scale (ADR-0018), e.g. 6 for unit prices. */
  readonly scale: number;
  /** Total digits the column holds; integer digits are limited to `precision − scale`. */
  readonly precision?: number;
  /** `positive`: greater than zero; `nonNegative`: zero or more; `any` (default): signed. */
  readonly sign?: "positive" | "nonNegative" | "any";
}

/**
 * An amount, price, quantity, or rate on the wire (ADR-0018): a canonical decimal string
 * (`"1250.50"`), never a JSON number, with at most `scale` decimals and no more integer digits
 * than its `numeric(precision, scale)` column holds. Read it with `Decimal.of`.
 */
export function decimalString(options: DecimalStringOptions): z.ZodString {
  const { scale, precision = 20, sign = "any" } = options;
  if (!Number.isSafeInteger(scale) || scale < 0 || !Number.isSafeInteger(precision)) {
    throw new RangeError("decimalString needs integer precision and scale");
  }
  if (precision <= scale) throw new RangeError("precision must exceed scale");
  const integerDigits = precision - scale;
  return z
    .string()
    .max(precision + 2)
    .regex(CANONICAL, "a decimal is canonical text like 1250.50")
    .refine((text) => (text.split(".")[1]?.length ?? 0) <= scale, {
      message: `at most ${String(scale)} decimal places`,
    })
    .refine((text) => (text.replace(/^-/, "").split(".")[0] ?? "").length <= integerDigits, {
      message: `at most ${String(integerDigits)} digits before the decimal point`,
    })
    .refine(
      (text) => {
        // Zod runs every check even after the format fails; that failure is already reported.
        if (sign === "any" || !CANONICAL.test(text)) return true;
        const value = Decimal.of(text);
        return sign === "positive" ? value.isPositive() : !value.isNegative();
      },
      { message: sign === "positive" ? "must be greater than zero" : "must not be negative" },
    );
}
