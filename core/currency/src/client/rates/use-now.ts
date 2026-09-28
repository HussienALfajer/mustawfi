import type { Clock } from "@mustawfi/kernel";
import { useEffect, useState } from "react";

/** How often a screen that depends on the business day reads the clock again. */
const TICK_MS = 60_000;

/**
 * The clock's time, read again every minute, so a screen that marks what predates the business
 * day (rule 12) notices the day change while it stays open.
 */
export function useNow(clock: Clock): Date {
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    setNow(clock.now());
    const timer = setInterval(() => {
      setNow(clock.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [clock]);
  return now;
}
