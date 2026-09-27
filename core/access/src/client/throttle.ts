/** A wait this short is the server being busy with the same key, not a throttle (rule 21). */
const MOMENT_S = 5;

/** A whole window, for an answer that did not say how long (rule 21). */
const WINDOW_MINUTES = 15;

/**
 * The whole minutes a throttled sign-in waits, from its answer's `Retry-After` (seconds): 0 for
 * a moment — two attempts of one account at once, or a flood being checked — and a whole window
 * when the answer did not say. The messages take it as `{minutes}` (0 reads «لحظة»).
 */
export function throttleWaitMinutes(retryAfterSeconds: number | undefined): number {
  if (retryAfterSeconds === undefined) return WINDOW_MINUTES;
  if (retryAfterSeconds <= MOMENT_S) return 0;
  return Math.ceil(retryAfterSeconds / 60);
}
