import { z } from "zod";

/**
 * Whether `pin` may be a PIN (`core-foundation` rule 19): 4–6 digits, not all the same digit,
 * and not a straight run up or down (`1234`, `4321`; no wrapping past 9 or 0).
 */
export function isPinAllowed(pin: string): boolean {
  if (!/^[0-9]{4,6}$/.test(pin)) return false;
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((digit, i) => digit - (digits[i] ?? 0));
  const repeated = steps.every((step) => step === 0);
  const runUp = steps.every((step) => step === 1);
  const runDown = steps.every((step) => step === -1);
  return !repeated && !runUp && !runDown;
}

/** A PIN as a user types it (rule 19). */
export const pinSchema = z
  .string()
  .refine(isPinAllowed, "a PIN is 4–6 digits, not one repeated digit, not a run like 1234");
