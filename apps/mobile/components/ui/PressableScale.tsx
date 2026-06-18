/**
 * Pressable that springs down on touch — the tactile feel that makes the UI
 * read as "alive" rather than flat.
 *
 * Built on React Native's built-in Animated API (useNativeDriver) rather than
 * Reanimated, so it runs everywhere — including Expo Go — with no native
 * worklets runtime to initialize. The scale still animates on the native
 * thread, so it stays smooth.
 */

import { type ReactNode, useRef } from 'react';
import {
  Animated,
  Pressable,
  type PressableProps,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { motion } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** How far it dips on press. Defaults to theme value. */
  scaleTo?: number;
}

export function PressableScale({
  children,
  style,
  scaleTo = motion.pressScale,
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const spring = (to: number) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 38,
      bounciness: 0,
    }).start();

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => { spring(scaleTo); onPressIn?.(e); }}
      onPressOut={(e) => { spring(1); onPressOut?.(e); }}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}
