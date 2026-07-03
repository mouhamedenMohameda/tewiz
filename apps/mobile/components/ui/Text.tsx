/**
 * Typographic <Text> bound to the design system.
 *
 *   <AppText variant="h1">Bonjour</AppText>
 *   <AppText variant="caption" color={colors.muted}>…</AppText>
 *
 * `variant` selects a ramp from theme.type; `color` and `style` override.
 * For Arabic & Hassaniya, automatically switches to the Louguiya family,
 * bumps the size up (Louguiya renders visually smaller than Sora at the same
 * point size), and renders digit runs in Sora for cleaner numerals.
 */

import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { colors, type } from '@/theme';
import { currentLanguage } from '@/lib/i18n';
import { fonts } from '@/theme/index';

type Variant = keyof typeof type;

/**
 * Louguiya has a smaller x-height / visual size than Sora, so the same
 * fontSize looks noticeably smaller in Arabic. Scale both size and lineHeight
 * up by this factor for `ar`/`hs` so Arabic text reads at a comparable weight.
 */
const ARABIC_FONT_SCALE = 1.35;

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

  // For Arabic/Hassaniya, switch to Louguiya; otherwise use the preset family.
  const fontFamily = isArabic
    ? fonts.arabic[getWeightKey(preset.fontWeight)]
    : preset.fontFamily;

  // Bump Arabic up a notch — Louguiya is visually smaller than Sora.
  const arabicSize = isArabic
    ? {
        fontSize: Math.round(preset.fontSize * ARABIC_FONT_SCALE),
        lineHeight: Math.round(preset.lineHeight * ARABIC_FONT_SCALE),
      }
    : null;

  // Render digits in Sora inside Arabic text — Louguiya's numerals are weak.
  const content = isArabic ? withSoraDigits(children, fonts.text[getWeightKey(preset.fontWeight)]) : children;

  return (
    <RNText
      {...rest}
      style={[
        preset,
        { color, fontFamily },
        arabicSize,
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
      {content}
    </RNText>
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

/**
 * Wrap runs of Western digits (0-9) in a nested <Text> that uses Sora, so
 * numerals in Arabic UI render with clean, familiar figures instead of
 * Louguiya's. Only transforms plain string/number children — anything richer
 * (nested elements, arrays) is returned untouched so we never drop content.
 */
function withSoraDigits(children: ReactNode, soraFamily: string): ReactNode {
  if (typeof children !== 'string' && typeof children !== 'number') return children;
  const str = String(children);
  if (!/\d/.test(str)) return children;

  // Split on digit runs, keeping them (capturing group → odd indices are digits).
  const parts = str.split(/(\d+)/);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <RNText key={i} style={{ fontFamily: soraFamily }}>
        {part}
      </RNText>
    ) : (
      part
    ),
  );
}
