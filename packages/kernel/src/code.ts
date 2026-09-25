import type { RandomSource } from "./random.ts";

/**
 * The 32 upper-case letters and digits people do not confuse — no `I`, `O`, `0`, or `1`
 * (ADR-0020): device prefixes, store codes, registration codes.
 */
export const UNAMBIGUOUS_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** `length` symbols of `UNAMBIGUOUS_ALPHABET`, each uniform (five bits of one random byte). */
export function randomCode(random: RandomSource, length: number): string {
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new RangeError("A code has at least one symbol");
  }
  let code = "";
  for (const byte of random.bytes(length)) code += UNAMBIGUOUS_ALPHABET.charAt(byte & 31);
  return code;
}

/**
 * A uniform integer in `[0, bound)`, `bound` at most 2^16, by rejection sampling so no value
 * is favoured.
 */
export function randomIndex(random: RandomSource, bound: number): number {
  if (!Number.isSafeInteger(bound) || bound < 1 || bound > 0x1_0000) {
    throw new RangeError("randomIndex takes a bound from 1 to 65536");
  }
  const limit = 0x1_0000 - (0x1_0000 % bound);
  for (;;) {
    const [high = 0, low = 0] = random.bytes(2);
    const value = (high << 8) | low;
    if (value < limit) return value % bound;
  }
}
