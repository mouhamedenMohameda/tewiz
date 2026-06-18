/**
 * Typographic <Text> bound to the design system.
 *
 *   <AppText variant="h1">Bonjour</AppText>
 *   <AppText variant="caption" color={colors.muted}>…</AppText>
 *
 * `variant` selects a ramp from theme.type; `color` and `style` override.
 */

import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { colors, type } from '@/theme';

type Variant = keyof typeof type;

export interface AppTextProps extends RNTextProps {
  variant?: Variant;
  color?: string;
  align?: TextStyle['textAlign'];
  /** Convenience tracking override. */
  tracking?: number;
}

export function AppText({
  variant = 'body',
  color = colors.ink,
  align,
  tracking,
  style,
  ...rest
}: AppTextProps) {
  const preset = type[variant];
  return (
    <RNText
      {...rest}
      style={[
        preset,
        { color },
        align ? { textAlign: align } : null,
        tracking != null ? { letterSpacing: tracking } : null,
        style,
      ]}
    />
  );
}
