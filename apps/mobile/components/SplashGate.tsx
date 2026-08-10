/**
 * SplashGate — shows the brand splash over the app on cold start, then removes
 * it once the splash has finished fading itself out.
 *
 * The gate does NOT pick its own duration. It reads SPLASH_DURATION_MS from the
 * splash component, because the two used to disagree badly: the gate unmounted
 * at a hardcoded 4000 ms while the animation was a ~9.7 s sequence, so users
 * sat through 4 s of branding AND never saw the ending — the splash was ripped
 * off mid-car-animation. Anything that changes the length of the brand moment
 * belongs in SplashScreen.tsx; this file just follows.
 *
 * Note this gate is mounted *below* the readiness gate in app/_layout.tsx: by
 * the time it renders, fonts and i18n have already resolved and the app shell
 * behind it is live. So this really is the only thing between the user and a
 * usable app — keep it short.
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import SplashScreen, { SPLASH_DURATION_MS } from './SplashScreen';

interface SplashGateProps {
  children: React.ReactNode;
  /** Escape hatch for tests / previews. Defaults to the splash's own budget. */
  showDuration?: number;
}

export const SplashGate: React.FC<SplashGateProps> = ({
  children,
  showDuration = SPLASH_DURATION_MS,
}) => {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    // Fires exactly when the splash's own fade-out reaches zero opacity, so the
    // unmount is invisible. We use a timer rather than the animation's
    // completion callback because the callback waits on the springs, which
    // settle some way past the point where the thing is already transparent.
    const timer = setTimeout(() => setShowSplash(false), showDuration);
    return () => clearTimeout(timer);
  }, [showDuration]);

  return (
    <View style={styles.container}>
      {children}
      {/* pointerEvents none: the app underneath is already interactive, so a
          user who knows where they're going can start tapping through the
          fade instead of waiting it out. */}
      {showSplash && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <SplashScreen />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default SplashGate;
