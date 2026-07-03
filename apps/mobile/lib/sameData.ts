/**
 * Re-render avoidance for polled screens.
 *
 * The fast screens (rider/current, captain/rides) refetch every 3–8 s and call
 * `setState(response.data)` on every tick — a brand-new object reference each
 * time, so React re-renders the whole screen even when the server returned the
 * exact same ride/inbox/history it did 3 s ago (the common case between real
 * state changes). Wrapping the setter with `keepIfEqual` makes an unchanged
 * tick a no-op: it returns the *previous* reference, which React compares with
 * `Object.is` and bails out of the render entirely.
 */

/**
 * Structural equality for the plain-JSON payloads the API returns. Same server
 * serialization ⇒ stable key order, so a stringify comparison is reliable and
 * cheap for these small objects. Falls back to `false` (i.e. "changed") if the
 * value isn't serializable, which is never worse than today's behaviour.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Build a functional state updater that keeps the previous value when it is
 * structurally equal to `next`, so React can skip the re-render.
 *
 * @example setRide(keepIfEqual(response.data))
 */
export function keepIfEqual<T>(next: T): (prev: T) => T {
  return (prev) => (jsonEqual(prev, next) ? prev : next);
}
