/**
 * Typographic <Text> bound to the design system.
 *
 *   <AppText variant="h1">Bonjour</AppText>
 *   <AppText variant="caption" color={colors.muted}>…</AppText>
 *
 * `variant` selects a ramp from theme.type; `color` and `style` override.
 * For Arabic & Hassaniya, automatically switches to Noto Kufi Arabic.
 */

import { useTranslation } from 'react-i18next';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { colors, type } from '@/theme';
import { currentLanguage } from '@/lib/i18n';
import { fonts } from '@/theme/index';

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
  // Trigger re-render when language changes.
  useTranslation();

  const lang = currentLanguage();
  const isArabic = lang === 'ar' || lang === 'hs';

  // For Arabic/Hassaniya, switch to Noto Kufi Arabic fonts; otherwise use the preset.
  const preset = type[variant];
  const fontFamily = isArabic
    ? fonts.arabic[getWeightKey(preset.fontWeight)]
    : preset.fontFamily;

  return (
    <RNText
      {...rest}
      style={[
        preset,
        { color, fontFamily },
        align ? { textAlign: align } : null,
        tracking != null ? { letterSpacing: tracking } : null,
        style,
      ]}
    />
  );
}

/** Map a weight to the corresponding arabic font key. */
function getWeightKey(weight: '400' | '500' | '600' | '700' | '800'): keyof typeof fonts.arabic {
  switch (weight) {
    case '400': return 'regular';
    case '500': return 'medium';
    case '600': return 'semibold';
    case '700': return 'bold';
    case '800': return 'extrabold';
  }
}
