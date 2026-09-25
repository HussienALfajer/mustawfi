/**
 * The only way domain code gets randomness: a `RandomSource` is passed in, so tests and the
 * sync simulation can seed it. `Math.random()` and `crypto.*` are lint errors in domain code
 * (ADR-0015 rule 6); this file is the one place that reads the platform's generator.
 */
export interface RandomSource {
  /** `length` fresh random bytes. */
  bytes(length: number): Uint8Array;
}

interface WebCrypto {
  getRandomValues<T extends Uint8Array>(array: T): T;
}

/** Cryptographically secure bytes from the platform (Web Crypto — browsers, Node, Tauri). */
export const cryptoRandom: RandomSource = {
  bytes: (length) => {
    const { crypto } = globalThis as unknown as { crypto: WebCrypto };
    return crypto.getRandomValues(new Uint8Array(length));
  },
};

/**
 * A deterministic generator (SplitMix32) for tests and the sync simulation harness: the same
 * seed gives the same bytes. Never use it for identifiers in production or for secrets.
 */
export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  return {
    bytes: (length) => {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i += 4) {
        let word = next();
        for (let j = i; j < Math.min(i + 4, length); j += 1) {
          out[j] = word & 0xff;
          word >>>= 8;
        }
      }
      return out;
    },
  };
}
