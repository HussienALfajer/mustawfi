import type { Clock } from "./clock.ts";
import type { RandomSource } from "./random.ts";

/** A UUIDv7 in canonical lowercase text — every primary key (ADR-0016). */
export type Uuid = string & { readonly __brand: "Uuid" };

export type IdGenerator = () => Uuid;

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const RANDOM_BITS = 74n; // 12 bits of rand_a + 62 bits of rand_b (RFC 9562 §5.7)
const RANDOM_LIMIT = 1n << RANDOM_BITS;
const MAX_TIMESTAMP = 2 ** 48 - 1;

export function isUuidV7(value: string): value is Uuid {
  return UUID_V7.test(value);
}

/** The Unix time in milliseconds stored in a UUIDv7's first 48 bits. */
export function uuidV7Timestamp(id: Uuid): number {
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}

function freshRandom(random: RandomSource): bigint {
  let value = 0n;
  for (const byte of random.bytes(10)) value = (value << 8n) | BigInt(byte);
  // 80 bits read; keep 73 so the counter below has room before it overflows (RFC 9562 §6.2).
  return value >> 7n;
}

/**
 * UUIDv7 generator (RFC 9562): 48-bit Unix milliseconds, then 74 random bits. Ids from one
 * generator sort strictly in creation order: within the same millisecond, or when the clock
 * steps back, the random part of the previous id is incremented (RFC 9562 §6.2, method 2).
 */
export function uuidV7Generator(dependencies: { clock: Clock; random: RandomSource }): IdGenerator {
  const { clock, random } = dependencies;
  let lastTimestamp = -1;
  let lastRandom = 0n;

  return () => {
    const now = clock.now().getTime();
    if (!Number.isSafeInteger(now) || now < 0 || now > MAX_TIMESTAMP) {
      throw new RangeError("The clock is outside the UUIDv7 timestamp range");
    }
    if (now > lastTimestamp) {
      lastTimestamp = now;
      lastRandom = freshRandom(random);
    } else {
      lastRandom += 1n;
      if (lastRandom === RANDOM_LIMIT) {
        if (lastTimestamp === MAX_TIMESTAMP) throw new RangeError("UUIDv7 timestamp overflow");
        lastTimestamp += 1;
        lastRandom = freshRandom(random);
      }
    }

    const randA = lastRandom >> 62n;
    const randB = lastRandom & ((1n << 62n) - 1n);
    const value =
      (BigInt(lastTimestamp) << 80n) | (0x7n << 76n) | (randA << 64n) | (0b10n << 62n) | randB;
    const hex = value.toString(16).padStart(32, "0");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as Uuid;
  };
}
