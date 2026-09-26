import { isIPv4, isIPv6 } from "node:net";

/**
 * Sign-in rate limiting (`core-foundation` rule 21, ADR-0022). Fixed here until `core-config`
 * makes them settings.
 */
export const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;

/** Failures of one store and login (password), or one user on one device (online PIN). */
export const LOGIN_FAILURE_LIMIT = 5;

/** Failures from one source address, whatever store or login they named. */
export const ADDRESS_FAILURE_LIMIT = 30;

/**
 * What the per-address limit counts a source address as. An IPv6 client usually holds a whole
 * /64 and can pick any address in it, so IPv6 addresses count per /64; an IPv4 address mapped
 * into IPv6 (`::ffff:192.0.2.1`) counts as itself.
 */
export function sourceAddressKey(address: string): string {
  const bare = address.split("%")[0] ?? address;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare)?.[1];
  if (mapped !== undefined && isIPv4(mapped)) return mapped;
  if (!isIPv6(bare)) return bare;
  const [head = "", tail] = bare.toLowerCase().split("::");
  const headGroups = head === "" ? [] : head.split(":");
  const tailGroups = tail === undefined || tail === "" ? [] : tail.split(":");
  const groups =
    tail === undefined
      ? headGroups
      : [
          ...headGroups,
          ...Array<string>(8 - headGroups.length - tailGroups.length).fill("0"),
          ...tailGroups,
        ];
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/**
 * Until when a key is throttled, or `undefined` when it may try now. `failures` are the times
 * of its failed attempts, in any order. The key is throttled once `limit` failures fall within
 * one window, for a window from the failure that reached the limit. Refused attempts are not
 * failures, so nothing is recorded while a key waits and the failure that reached the limit
 * stays the newest.
 */
export function throttledUntil(
  failures: readonly Date[],
  limit: number,
  windowMs: number,
  now: Date,
): Date | undefined {
  if (failures.length < limit) return undefined;
  const newestFirst = failures.map((at) => at.getTime()).sort((a, b) => b - a);
  const newest = newestFirst[0] ?? 0;
  const oldest = newestFirst[limit - 1] ?? 0;
  if (newest - oldest >= windowMs) return undefined;
  const until = newest + windowMs;
  return until > now.getTime() ? new Date(until) : undefined;
}

/** One attempt counted by a `FailureCounter`: it ends as a failure or not. */
export interface CountedAttempt {
  /** The attempt failed: it counts toward the limit. */
  fail(): void;
  /** The attempt succeeded, or was refused before any check: it does not count. */
  release(): void;
}

interface CounterEntry {
  failures: number[];
  pending: number;
  /** The end of the window whose refusals are already audited, per tenant. */
  audited: Map<string, number>;
}

/**
 * Failed attempts per key, counted in the server process's memory: per source address, which
 * may name no tenant, and per store code and login for store codes that name no tenant, so
 * that they are answered like known ones (ADR-0029). V1 runs one server process; a restart
 * forgets the counts, and the per-login limit in the database still holds.
 *
 * Attempts in flight count as failures until they end, so a burst of parallel attempts cannot
 * pass the check together before any of them fails.
 */
export class FailureCounter {
  readonly #entries = new Map<string, CounterEntry>();
  /** When idle keys were last swept, so a full counter is not scanned for every new key. */
  #sweptAt = Number.NEGATIVE_INFINITY;
  readonly limit: number;
  readonly windowMs: number;
  /** Keys kept at most; the oldest are forgotten first. */
  readonly maxKeys: number;

  constructor(limit: number, windowMs: number = SIGN_IN_WINDOW_MS, maxKeys = 100_000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  /** Until when `key` is throttled at `now`, or `undefined` when it may try. */
  throttledUntil(key: string, now: Date): Date | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    this.#prune(entry, now);
    const failures = entry.failures.map((at) => new Date(at));
    return throttledUntil(failures, this.limit, this.windowMs, now);
  }

  /**
   * Whether the attempts of `key` in flight would reach the limit if they failed: a new one is
   * refused for a moment (not throttled, and not audited) until they end.
   */
  busy(key: string, now: Date): boolean {
    const entry = this.#entries.get(key);
    if (entry === undefined) return false;
    const recent = entry.failures.filter((at) => at > now.getTime() - this.windowMs).length;
    return recent + entry.pending >= this.limit;
  }

  /** Starts an attempt for `key` at `now`; end it with `fail` or `release`, once. */
  begin(key: string, now: Date): CountedAttempt {
    const entry = this.#entry(key, now);
    entry.pending += 1;
    let ended = false;
    const end = () => {
      if (ended) throw new Error("the attempt already ended");
      ended = true;
      entry.pending -= 1;
    };
    return {
      fail: () => {
        end();
        entry.failures.push(now.getTime());
        this.#prune(entry, now);
      },
      release: end,
    };
  }

  /**
   * Whether a refusal of `key` in `tenantId`'s store, throttled `until`, is the first of its
   * window there, so it is audited once per window (rule 21). Marks it audited.
   */
  firstRefusal(key: string, tenantId: string, until: Date, now: Date): boolean {
    const entry = this.#entry(key, now);
    const audited = entry.audited.get(tenantId);
    if (audited !== undefined && audited > now.getTime()) return false;
    entry.audited.set(tenantId, until.getTime());
    return true;
  }

  /** How many keys are kept (tests). */
  get size(): number {
    return this.#entries.size;
  }

  #entry(key: string, now: Date): CounterEntry {
    let entry = this.#entries.get(key);
    if (entry === undefined) {
      if (this.#entries.size >= this.maxKeys) this.#sweep(now);
      entry = { failures: [], pending: 0, audited: new Map() };
      this.#entries.set(key, entry);
    }
    return entry;
  }

  /** Keeps the failures that can still matter: the last `limit`, within two windows. */
  #prune(entry: CounterEntry, now: Date): void {
    const since = now.getTime() - 2 * this.windowMs;
    entry.failures = entry.failures.filter((at) => at > since).slice(-this.limit);
  }

  /** Forgets idle keys, at most once a minute; then, if still full, the oldest keys. */
  #sweep(now: Date): void {
    if (now.getTime() - this.#sweptAt >= 60_000) this.#sweepIdle(now);
    while (this.#entries.size >= this.maxKeys) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
  }

  #sweepIdle(now: Date): void {
    this.#sweptAt = now.getTime();
    for (const [key, entry] of this.#entries) {
      this.#prune(entry, now);
      const auditing = [...entry.audited.values()].some((until) => until > now.getTime());
      if (entry.failures.length === 0 && entry.pending === 0 && !auditing) {
        this.#entries.delete(key);
      }
    }
  }
}

/** The in-memory counters of one server process. */
export interface SignInThrottles {
  /** Per source address (`ADDRESS_FAILURE_LIMIT`). */
  readonly addresses: FailureCounter;
  /** Per store code and login, for store codes that name no tenant (`LOGIN_FAILURE_LIMIT`). */
  readonly unknownStores: FailureCounter;
}

export function signInThrottles(): SignInThrottles {
  return {
    addresses: new FailureCounter(ADDRESS_FAILURE_LIMIT),
    unknownStores: new FailureCounter(LOGIN_FAILURE_LIMIT),
  };
}
