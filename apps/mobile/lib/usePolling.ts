import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { runGuarded } from './pollGuard';

/**
 * Fire `cb` every `intervalMs` while the screen is focused. The interval is
 * paused when the screen loses focus (so navigation, backgrounding, or pulling
 * up the OS shade stops the network chatter).
 *
 * `cb` does NOT run immediately when focus is gained — the parent screen is
 * expected to do its own initial fetch in a `useEffect`. The first tick fires
 * after `intervalMs`.
 *
 * Ticks are guarded (see `runGuarded`): if the previous invocation is still in
 * flight, the next tick is skipped instead of stacking a second request — this
 * matters on the fast (3 s) live-meter screens over a weak network.
 */
export function usePolling(cb: () => void | Promise<void>, intervalMs: number) {
  // Keep the latest callback in a ref so we don't reset the interval whenever
  // the parent re-renders with a new function identity.
  const ref = useRef(cb);
  useEffect(() => { ref.current = cb; }, [cb]);

  // Survives across ticks (and focus changes): true while a tick's callback is
  // still awaiting, so an overlapping tick is dropped.
  const inFlight = useRef(false);

  useFocusEffect(
    useCallback(() => {
      const id = setInterval(() => { void runGuarded(inFlight, ref.current); }, intervalMs);
      return () => clearInterval(id);
    }, [intervalMs]),
  );
}
