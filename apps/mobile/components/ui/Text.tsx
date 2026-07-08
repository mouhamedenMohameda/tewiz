/**
 * Typographic <Text> bound to the design system.
 *
 *   <AppText variant="h1">Bonjour</AppText>
 *   <AppText variant="caption" color={colors.muted}>…</AppText>
 *
 * `variant` selects a ramp from theme.type; `color` and `style` override.
 * Uses Sora for every script — Arabic glyphs Sora lacks fall back to system.
 */

import { useTranslation } from 'react-i18next';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { colors, type } from '@/theme';
import { currentLanguage } from '@/lib/i18n';

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
  children,
  ...rest
}: AppTextProps) {
  // Trigger re-render when language changes.
  useTranslation();

  const lang = currentLanguage();
  const isArabic = lang === 'ar' || lang === 'hs';

  const preset = type[variant];

  return (
    <RNText
      {...rest}
      style={[
        preset,
        { color },
        // Arabic reads right-to-left: default text alignment must be `right`
        // even when the native layout direction is still LTR (the user hasn't
        // restarted after switching to Arabic yet). Placed before `align` and
        // `style` so an explicit caller override still wins.
        isArabic ? { textAlign: 'right' as const, writingDirection: 'rtl' as const } : null,
        align ? { textAlign: align } : null,
        tracking != null ? { letterSpacing: tracking } : null,
        style,
        // Arabic is cursive: any letterSpacing — whether from the preset, a
        // `tracking` prop, or a caller `style` override — is applied as CoreText
        // kerning on iOS and breaks the shaping. The i'jam dots drop (متّصل
        // renders as مصل) and joined letters split apart. So spacing is forced
        // off last for Arabic scripts; its textTransform is meaningless too.
        isArabic ? { letterSpacing: 0, textTransform: 'none' as const } : null,
      ]}
    >
      {children}
    </RNText>
  );
}
