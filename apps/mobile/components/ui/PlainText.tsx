/**
 * PlainText — a drop-in replacement for react-native's <Text> in legacy screens
 * that predate the design system.
 *
 * Unlike <AppText>, it applies NO typographic preset: the caller's inline
 * styles (fontSize, lineHeight, color, fontWeight…) render verbatim, so swapping
 * `Text` → `PlainText` never shifts an existing layout. Its only job is to lift
 * Arabic (ar/hs) off the system font onto the weight-matched Cairo face, plus
 * the RTL alignment and letterSpacing:0 that Arabic shaping needs.
 *
 * Usage in a legacy file:
 *   import { PlainText as Text } from '@/components/ui';
 */

import { useTranslation } from 'react-i18next';
import { I18nManager, Platform, Text as RNText, type TextProps } from 'react-native';
import { currentLanguage, isRTL } from '@/lib/i18n';
import { DEFAULT_MAX_FONT_SCALE } from '@/theme';
import { arabicFaceForStyle, arabicLineHeight } from './arabicFont';

export function PlainText({ style, ...rest }: TextProps) {
  // Re-render when the language changes.
  useTranslation();
  const isArabic = isRTL(currentLanguage());

  return (
    <RNText
      // No ramp step to look up here, so a single conservative ceiling. Callers
      // that know better pass their own.
      maxFontSizeMultiplier={DEFAULT_MAX_FONT_SCALE}
      {...rest}
      style={[
        // Alignment follows the LANGUAGE via the paragraph's base writing
        // direction on iOS (natural alignment — deterministic in every
        // container), explicit physical alignment on Android — see <AppText>
        // for the full rationale. Goes BEFORE the caller style so an explicit
        // textAlign (e.g. 'center') still wins.
        isArabic
          ? Platform.OS === 'ios'
            ? { writingDirection: 'rtl' as const }
            : { textAlign: 'right' as const, writingDirection: 'rtl' as const }
          : I18nManager.isRTL
            ? Platform.OS === 'ios'
              ? { writingDirection: 'ltr' as const }
              : { textAlign: 'left' as const, writingDirection: 'ltr' as const }
            : null,
        style,
        // Cairo face + letterSpacing:0 go AFTER so they win over any Sora
        // fontFamily the caller passed for weight, and over preset letterSpacing
        // (which breaks Arabic shaping on iOS — dropped i'jam dots). The raised
        // lineHeight keeps Cairo's high dots inside the line box (undefined when
        // the caller declared none — natural metrics never clip).
        isArabic
          ? {
              fontFamily: arabicFaceForStyle(style),
              letterSpacing: 0,
              lineHeight: arabicLineHeight(style),
            }
          : null,
      ]}
    />
  );
}
