/**
 * The only way domain code reads the time: a `Clock` is passed in, so tests and the sync
 * simulation control it. Reading the time directly (`Date.now()`, `new Date()`) is a lint
 * error in domain code (ADR-0015 rule 6); this file is the one place that does it.
 */
export interface Clock {
  /** The current instant, as a new `Date` the caller may keep. */
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** A clock that moves only when told to — for tests and the sync simulation harness. */
export interface ManualClock extends Clock {
  set(instant: Date): void;
  advance(milliseconds: number): void;
}

export function manualClock(start: Date): ManualClock {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    set: (instant) => {
      current = instant.getTime();
    },
    advance: (milliseconds) => {
      if (!Number.isSafeInteger(milliseconds)) {
        throw new RangeError("Advance a manual clock by whole milliseconds");
      }
      current += milliseconds;
    },
  };
}
