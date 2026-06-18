/**
 * Card — a warm raised surface. Static by default; pass `onPress` to make it a
 * springy, tappable row/tile. The warm-tinted shadow (theme.shadow.card) is the
 * detail that separates this from the old flat, borderless boxes.
 */

import { type ReactNode } from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, shadow, spacing } from '@/theme';
import { PressableScale } from './PressableScale';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padding?: number;
  /** 'card' (default), 'raised' for floating, or 'none' for flush. */
  elevation?: 'card' | 'raised' | 'none';
  /** Override surface color (e.g. a tinted state). */
  background?: string;
  borderColor?: string;
}

export function Card({
  children,
  onPress,
  style,
  padding = spacing.base,
  elevation = 'card',
  background = colors.surface,
  borderColor,
}: CardProps) {
  const base: StyleProp<ViewStyle> = [
    styles.base,
    {
      padding,
      backgroundColor: background,
      borderColor: borderColor ?? 'transparent',
      borderWidth: borderColor ? 1 : 0,
    },
    elevation === 'card' ? shadow.card : elevation === 'raised' ? shadow.raised : null,
    style,
  ];

  if (onPress) {
    return (
      <PressableScale onPress={onPress} style={base} scaleTo={0.98}>
        {children}
      </PressableScale>
    );
  }
  return <View style={base}>{children}</View>;
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.xl },
});
