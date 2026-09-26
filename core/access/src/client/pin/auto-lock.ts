import type { Clock } from "@mustawfi/kernel";
import type { LocalDb } from "@mustawfi/local-db";
import { useEffect, useEffectEvent } from "react";
import { lastActivityAt, recordActivity } from "./local-sign-in.ts";

/** What counts as input (rule 24): keys, the pointer, the wheel, a touch. */
const INPUT_EVENTS = ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"] as const;

/** How often the idle time is checked. */
const CHECK_EVERY_MS = 5_000;

/**
 * How often input is written to the local database: a restart within the idle time keeps the
 * session, a later one finds it idle (`restoreDeviceSession`).
 */
const RECORD_EVERY_MS = 30_000;

export interface AutoLockOptions {
  readonly db: LocalDb;
  readonly clock: Clock;
  readonly idleMs: number;
  /** Only while a user is signed in on this device. */
  readonly enabled: boolean;
  /** The idle time passed without input: the app ends the session and shows the PIN screen. */
  readonly onLock: () => void;
}

/**
 * Auto-lock (`core-foundation` rule 24): after `idleMs` without input the device returns to the
 * PIN screen. What the session leaves open — the cart — is already in the local database. Not
 * audited: the next sign-in is.
 */
export function useAutoLock({ db, clock, idleMs, enabled, onLock }: AutoLockOptions): void {
  const lock = useEffectEvent(onLock);
  useEffect(() => {
    if (!enabled) return;
    let lastInput = clock.now().getTime();
    let recorded = lastInput;
    let touched = false;
    // A session restored at start-up has been idle since its last recorded input, not since now.
    void lastActivityAt(db).then((stored) => {
      if (!touched && stored !== undefined && stored < lastInput) lastInput = stored;
    });
    const onInput = () => {
      touched = true;
      lastInput = clock.now().getTime();
      if (lastInput - recorded < RECORD_EVERY_MS) return;
      recorded = lastInput;
      recordActivity(db, new Date(lastInput)).catch((error: unknown) => {
        console.error("the last input could not be recorded", error);
      });
    };
    for (const event of INPUT_EVENTS) {
      window.addEventListener(event, onInput, { capture: true, passive: true });
    }
    const timer = setInterval(() => {
      if (clock.now().getTime() - lastInput >= idleMs) {
        clearInterval(timer);
        lock();
      }
    }, CHECK_EVERY_MS);
    return () => {
      clearInterval(timer);
      for (const event of INPUT_EVENTS) {
        window.removeEventListener(event, onInput, { capture: true });
      }
    };
  }, [db, clock, idleMs, enabled]);
}
