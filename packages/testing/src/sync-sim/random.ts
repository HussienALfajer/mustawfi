import { type RandomSource, seededRandom } from "@mustawfi/kernel";

/**
 * The harness's only randomness (ADR-0026): every choice of a simulation run — which device
 * acts, what it sells, which request the network drops — comes from one seed, so a failing
 * run is replayed by its seed. Each actor takes its own stream (`fork`), so one actor's
 * choices do not shift when another actor draws more or less.
 */
export interface SimRandom {
  readonly seed: number;
  /** True with the given probability, from 0 to 1. */
  chance(probability: number): boolean;
  /** A uniform integer from `min` to `max`, both included. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** A new array with `items` in a random order. */
  shuffle<T>(items: readonly T[]): T[];
  /** An independent stream named `label`, the same for the same seed and label. */
  fork(label: string): SimRandom;
  /** Bytes for kernel code (ids) from this stream. */
  readonly source: RandomSource;
}

const TWO_TO_32 = 0x1_0000_0000;

/** FNV-1a over the label, mixed with the parent seed. */
function childSeed(seed: number, label: string): number {
  let hash = 0x811c9dc5 ^ seed;
  for (let i = 0; i < label.length; i += 1) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function simRandom(seed: number): SimRandom {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed >= TWO_TO_32) {
    throw new RangeError("A simulation seed is an integer from 0 to 2^32 - 1");
  }
  const source = seededRandom(seed);
  const uint32 = (): number => {
    const [a = 0, b = 0, c = 0, d = 0] = source.bytes(4);
    return (a | (b << 8) | (c << 16) | (d << 24)) >>> 0;
  };
  const int = (min: number, max: number): number => {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
      throw new RangeError("int takes whole bounds with min <= max");
    }
    const range = max - min + 1;
    if (range > TWO_TO_32) throw new RangeError("int takes a range of at most 2^32");
    // Rejection sampling, so no value is favoured.
    const limit = TWO_TO_32 - (TWO_TO_32 % range);
    for (;;) {
      const value = uint32();
      if (value < limit) return min + (value % range);
    }
  };
  return {
    seed,
    chance: (probability) => {
      if (!(probability >= 0 && probability <= 1)) {
        throw new RangeError("A probability is from 0 to 1");
      }
      return uint32() / TWO_TO_32 < probability;
    },
    int,
    pick: (items) => {
      if (items.length === 0) throw new RangeError("pick takes at least one item");
      return items[int(0, items.length - 1)] as (typeof items)[number];
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j] as (typeof out)[number], out[i] as (typeof out)[number]];
      }
      return out;
    },
    fork: (label) => simRandom(childSeed(seed, label)),
    source,
  };
}
