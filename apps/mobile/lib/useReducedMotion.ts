/**
 * Reduced Motion — the OS-level accessibility setting (iOS: Settings →
 * Accessibility → Motion → Reduce Motion; Android: Remove animations).
 *
 * "Reduced" does not mean "none". People who turn this on still need to know
 * that their tap registered and that a sheet opened — they just can't take the
 * large sliding/springing travel, which is vestibular. So every animated
 * primitive in the app keeps its feedback and swaps the motion for a short
 * cross-fade: same information, no movement.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => { if (alive) setReduced(value); })
      // Never let an accessibility probe break a screen — worst case we
      // animate normally, which is the behaviour we had before.
      .catch(() => {});

    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);

    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return reduced;
}
