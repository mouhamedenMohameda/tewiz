/**
 * Re-entrancy guard for interval polling, split out of `usePolling` so it can
 * be unit-tested in the node env without dragging in react / expo-router.
 */

/** A mutable single-field holder — a React ref satisfies this shape. */
export interface Flag {
  current: boolean;
}

/**
 * Run `cb` unless a previous invocation is still pending. `flag` carries the
 * in-flight state across calls (a React ref in the hook), so a slow request on
 * a weak network makes the next tick a no-op instead of stacking a second
 * request on top of the first. The flag is always cleared afterwards — even if
 * `cb` throws — so a failed tick can't wedge polling permanently.
 *
 * @returns `true` if `cb` was invoked, `false` if the tick was skipped.
 */
export async function runGuarded(flag: Flag, cb: () => void | Promise<void>): Promise<boolean> {
  if (flag.current) return false;
  flag.current = true;
  try {
    await cb();
  } finally {
    flag.current = false;
  }
  return true;
}
