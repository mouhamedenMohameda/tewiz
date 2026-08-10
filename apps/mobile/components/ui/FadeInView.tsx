/**
 * FadeInView — a gentle "rise + fade" entrance on mount.
 *
 * Replaces Reanimated's `entering={FadeInDown}` layout animations with the
 * built-in Animated API so it works in Expo Go (no worklets runtime). Stagger
 * blocks with `delay` for a polished cascade.
 *
 * Keep `delay` values TIGHT — under ~50 ms between siblings. The cascade is
 * meant to read as one motion with a bit of depth, not as blocks arriving one
 * after another: the last element's `delay + duration` is, in practice, how
 * long the screen takes to exist as far as the user is concerned. The home
 * screen used to stagger out to 270 ms on a 460 ms fade, so its bottom half
 * only landed 730 ms after the data was already there.
 */

import { type ReactNode, useEffect, useRef } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { motion } from '@/theme';

export interface FadeInViewProps {
  children: ReactNode;
  /** Start delay in ms (for staggering). */
  delay?: number;
  /** Vertical travel distance. */
  offset?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}

export function FadeInView({
  children,
  delay = 0,
  offset = 12,
  duration = 300,
  style,
}: FadeInViewProps) {
  const t = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const anim = Animated.timing(t, {
      toValue: 1,
      // Under Reduce Motion the content still fades in — it just doesn't
      // travel, and it arrives sooner because there's no movement to read.
      duration: reduceMotion ? motion.reducedFade : duration,
      delay: reduceMotion ? 0 : delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [t, delay, duration, reduceMotion]);

  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] });

  return (
    <Animated.View
      style={[
        reduceMotion ? { opacity: t } : { opacity: t, transform: [{ translateY }] },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}
