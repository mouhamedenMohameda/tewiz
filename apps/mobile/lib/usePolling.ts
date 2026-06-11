import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Fire `cb` every `intervalMs` while the screen is focused. The interval is
 * paused when the screen loses focus (so navigation, backgrounding, or pulling
 * up the OS shade stops the network chatter).
 *
 * `cb` does NOT run immediately when focus is gained — the parent screen is
 * expected to do its own initial fetch in a `useEffect`. The first tick fires
 * after `intervalMs`.
 */
export function usePolling(cb: () => void | Promise<void>, intervalMs: number) {
  // Keep the latest callback in a ref so we don't reset the interval whenever
  // the parent re-renders with a new function identity.
  const ref = useRef(cb);
  useEffect(() => { ref.current = cb; }, [cb]);

  useFocusEffect(
    useCallback(() => {
      const id = setInterval(() => { ref.current(); }, intervalMs);
      return () => clearInterval(id);
    }, [intervalMs]),
  );
}
