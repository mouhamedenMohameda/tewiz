/**
 * FadeInView — a gentle "rise + fade" entrance on mount.
 *
 * Replaces Reanimated's `entering={FadeInDown}` layout animations with the
 * built-in Animated API so it works in Expo Go (no worklets runtime). Stagger
 * blocks with `delay` for a polished cascade.
 */

import { type ReactNode, useEffect, useRef } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

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
  offset = 16,
  duration = 460,
  style,
}: FadeInViewProps) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(t, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [t, delay, duration]);

  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] });

  return (
    <Animated.View style={[{ opacity: t, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}
