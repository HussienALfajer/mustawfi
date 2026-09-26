import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import {
  ADDRESS_FAILURE_LIMIT,
  FailureCounter,
  LOGIN_FAILURE_LIMIT,
  SIGN_IN_WINDOW_MS,
  sourceAddressKey,
  throttledUntil,
} from "./throttle.ts";

const START = new Date("2026-09-26T08:00:00.000Z").getTime();
const MINUTE = 60_000;
const at = (minutes: number) => new Date(START + minutes * MINUTE);

describe("rule 21's numbers", () => {
  it("are five per login, thirty per address, within fifteen minutes", () => {
    expect(LOGIN_FAILURE_LIMIT).toBe(5);
    expect(ADDRESS_FAILURE_LIMIT).toBe(30);
    expect(SIGN_IN_WINDOW_MS).toBe(15 * MINUTE);
  });
});

describe("throttledUntil", () => {
  const failures = [at(0), at(1), at(2), at(3), at(4)];

  it("lets four failures through, and throttles the fifth for a window from it", () => {
    expect(throttledUntil(failures.slice(0, 4), 5, SIGN_IN_WINDOW_MS, at(4))).toBeUndefined();
    expect(throttledUntil(failures, 5, SIGN_IN_WINDOW_MS, at(4))).toEqual(at(19));
    expect(throttledUntil(failures, 5, SIGN_IN_WINDOW_MS, at(18.99))).toEqual(at(19));
  });

  it("lifts at the end of the window: the boundary instant is free", () => {
    expect(throttledUntil(failures, 5, SIGN_IN_WINDOW_MS, at(19))).toBeUndefined();
  });

  it("does not count failures spread over more than a window", () => {
    const spread = [at(0), at(4), at(8), at(12), at(15)];
    expect(throttledUntil(spread, 5, SIGN_IN_WINDOW_MS, at(15))).toBeUndefined();
  });

  it("reads failures in any order", () => {
    expect(throttledUntil([...failures].reverse(), 5, SIGN_IN_WINDOW_MS, at(5))).toEqual(at(19));
  });

  /**
   * A key that tries at random times, refused while throttled: whatever the times, no window
   * holds more than `limit` recorded failures, every refusal waits at most a window, and a
   * key is refused only within a window of a failure that reached the limit.
   */
  test.prop([
    fc.array(fc.integer({ min: 0, max: 120 * MINUTE }), { minLength: 1, maxLength: 80 }),
    fc.integer({ min: 1, max: 8 }),
  ])("never records more than the limit within one window", (times, limit) => {
    const recorded: number[] = [];
    for (const time of [...times].sort((a, b) => a - b)) {
      const now = new Date(START + time);
      const until = throttledUntil(
        recorded.map((t) => new Date(t)),
        limit,
        SIGN_IN_WINDOW_MS,
        now,
      );
      if (until === undefined) {
        recorded.push(now.getTime());
      } else {
        expect(until.getTime()).toBeGreaterThan(now.getTime());
        expect(until.getTime() - now.getTime()).toBeLessThanOrEqual(SIGN_IN_WINDOW_MS);
        const newest = recorded.at(-1) ?? Number.NaN;
        const reaching = recorded.at(-limit) ?? Number.NaN;
        expect(newest - reaching).toBeLessThan(SIGN_IN_WINDOW_MS);
        expect(until.getTime()).toBe(newest + SIGN_IN_WINDOW_MS);
      }
    }
    for (const start of recorded) {
      const inWindow = recorded.filter((t) => t >= start && t < start + SIGN_IN_WINDOW_MS);
      expect(inWindow.length).toBeLessThanOrEqual(limit);
    }
  });
});

describe("FailureCounter", () => {
  it("throttles a key after its limit of failures, and only that key", () => {
    const counter = new FailureCounter(3);
    for (let i = 0; i < 3; i += 1) {
      expect(counter.throttledUntil("a", at(i))).toBeUndefined();
      counter.begin("a", at(i)).fail();
    }
    expect(counter.throttledUntil("a", at(3))).toEqual(at(17));
    expect(counter.throttledUntil("b", at(3))).toBeUndefined();
    expect(counter.throttledUntil("a", at(17))).toBeUndefined();
  });

  it("does not count successes or refusals", () => {
    const counter = new FailureCounter(2);
    counter.begin("a", at(0)).release();
    counter.begin("a", at(0)).fail();
    counter.begin("a", at(1)).release();
    expect(counter.throttledUntil("a", at(2))).toBeUndefined();
  });

  it("counts attempts in flight, so a parallel burst cannot pass the check together", () => {
    const counter = new FailureCounter(3);
    const burst = [counter.begin("a", at(0)), counter.begin("a", at(0))];
    counter.begin("a", at(0)).fail();
    expect(counter.busy("a", at(0))).toBe(true);
    // Busy is not throttled: nothing is audited and the wait is a moment.
    expect(counter.throttledUntil("a", at(0))).toBeUndefined();
    for (const attempt of burst) attempt.release();
    expect(counter.busy("a", at(0))).toBe(false);
  });

  it("ignores old failures when counting attempts in flight", () => {
    const counter = new FailureCounter(3);
    counter.begin("a", at(0)).fail();
    counter.begin("a", at(0)).fail();
    const inFlight = counter.begin("a", at(20));
    expect(counter.busy("a", at(20))).toBe(false);
    inFlight.release();
  });

  it("ends an attempt once", () => {
    const attempt = new FailureCounter(3).begin("a", at(0));
    attempt.fail();
    expect(() => attempt.release()).toThrow();
  });

  it("marks the first refusal of a window per tenant, and again in the next window", () => {
    const counter = new FailureCounter(1);
    counter.begin("a", at(0)).fail();
    const until = counter.throttledUntil("a", at(1));
    if (until === undefined) throw new Error("expected a throttle");
    expect(counter.firstRefusal("a", "tenant-1", until, at(1))).toBe(true);
    expect(counter.firstRefusal("a", "tenant-1", until, at(2))).toBe(false);
    expect(counter.firstRefusal("a", "tenant-2", until, at(2))).toBe(true);

    counter.begin("a", at(16)).fail();
    const next = counter.throttledUntil("a", at(16));
    if (next === undefined) throw new Error("expected a throttle");
    expect(counter.firstRefusal("a", "tenant-1", next, at(16))).toBe(true);
  });

  it("keeps at most its number of keys, forgetting idle ones first", () => {
    const counter = new FailureCounter(2, SIGN_IN_WINDOW_MS, 3);
    counter.begin("old", at(0)).fail();
    counter.begin("busy", at(40)).fail();
    counter.begin("idle", at(40)).release();
    counter.begin("new", at(41)).fail();
    expect(counter.size).toBeLessThanOrEqual(3);
    // "busy" failed within the window and stays; "old" and "idle" had nothing left to count.
    counter.begin("busy", at(41)).fail();
    expect(counter.throttledUntil("busy", at(42))).toEqual(at(56));
  });
});

describe("sourceAddressKey", () => {
  it("counts an IPv4 address as itself, mapped into IPv6 or not", () => {
    expect(sourceAddressKey("203.0.113.7")).toBe("203.0.113.7");
    expect(sourceAddressKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("counts IPv6 addresses per /64, whatever their spelling", () => {
    const key = "2001:db8:1:2::/64";
    expect(sourceAddressKey("2001:db8:1:2::1")).toBe(key);
    expect(sourceAddressKey("2001:0db8:0001:0002:ffff:eeee:dddd:cccc")).toBe(key);
    expect(sourceAddressKey("2001:DB8:1:2:0:0:0:9")).toBe(key);
    expect(sourceAddressKey("2001:db8:1:3::1")).not.toBe(key);
    expect(sourceAddressKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(sourceAddressKey("::1")).toBe("0:0:0:0::/64");
  });

  it("leaves anything else as it is", () => {
    expect(sourceAddressKey("unknown")).toBe("unknown");
  });
});
