/**
 * Pressable that springs down under the thumb — the tactile feel that makes the
 * UI read as "alive" rather than flat.
 *
 * Two things matter here more than the animation itself:
 *
 *  - The dip happens on press-IN, not on release. The instant a finger lands,
 *    the control moves. Waiting for the tap to complete before acknowledging it
 *    is the single fastest way to make an interface feel dead, and no amount of
 *    polish downstream recovers from it.
 *  - It is a spring, not a timed animation, so a fast double-tap or a
 *    press-drag-release retargets mid-flight and stays continuous instead of
 *    restarting from the top. (React Native's spring carries its velocity into
 *    the next spring on the same value, so reversals have no hard edge.)
 *
 * Built on the built-in Animated API rather than Reanimated, so it runs
 * everywhere — including Expo Go — with no worklets runtime to initialise. The
 * scale still animates on the native thread, so it stays smooth.
 */

import { type ReactNode, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  type PressableProps,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { motion } from '@/theme';
import { springConfig } from '@/lib/motion';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { haptics } from '@/lib/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Reduce Motion still needs an acknowledgement — it just can't be travel. */
const REDUCED_PRESS_OPACITY = 0.6;

export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** How far it dips on press. Defaults to theme value. */
  scaleTo?: number;
  /**
   * Fire a haptic tick the moment the finger lands. Off by default on purpose:
   * feedback on every tap is feedback on nothing. Turn it on for controls where
   * the press itself is the meaningful event (a mic button, a snap, a commit).
   */
  haptic?: boolean;
}

export function PressableScale({
  children,
  style,
  scaleTo = motion.pressScale,
  haptic = false,
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const dim = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();

  const press = (down: boolean) => {
    if (reduceMotion) {
      // No travel — but the control must still visibly answer the touch.
      Animated.timing(dim, {
        toValue: down ? 1 : 0,
        duration: motion.fast,
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.spring(scale, {
      toValue: down ? scaleTo : 1,
      ...springConfig(motion.spring.press),
    }).start();
  };

  // The caller may already be dimming this control (Button does it for
  // `disabled`), so the press dim multiplies that rather than replacing it.
  const restOpacity = (StyleSheet.flatten(style) as ViewStyle | undefined)?.opacity ?? 1;
  const feedbackStyle = reduceMotion
    ? {
        opacity: dim.interpolate({
          inputRange: [0, 1],
          outputRange: [restOpacity as number, (restOpacity as number) * REDUCED_PRESS_OPACITY],
        }),
      }
    : { transform: [{ scale }] };

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        press(true);
        // Same frame as the visual: a haptic that trails the animation reads as
        // a glitch rather than as a response.
        if (haptic) haptics.selection();
        onPressIn?.(e);
      }}
      onPressOut={(e) => { press(false); onPressOut?.(e); }}
      style={[style, feedbackStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
