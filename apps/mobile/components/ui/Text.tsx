/**
 * Typographic <Text> bound to the design system.
 *
 *   <AppText variant="h1">Bonjour</AppText>
 *   <AppText variant="caption" color={colors.muted}>…</AppText>
 *
 * `variant` selects a ramp from theme.type; `color` and `style` override.
 * Latin scripts render in Sora; Arabic (ar/hs) renders in Cairo — chosen at
 * the weight the caller asked for, even if that weight was expressed as a Sora
 * face or a fontWeight in `style`.
 */

import { useTranslation } from 'react-i18next';
import {
  I18nManager,
  Platform,
  Text as RNText,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native';
import { colors, maxFontScale, type } from '@/theme';
import { currentLanguage, isRTL } from '@/lib/i18n';
import { arabicFaceForStyle, arabicLineHeight } from './arabicFont';

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

  const isArabic = isRTL(currentLanguage());
  const preset = type[variant];
  const arFace = isArabic ? arabicFaceForStyle(style, preset.fontWeight) : undefined;

  return (
    <RNText
      // Dynamic Type: the OS setting is honoured, but each ramp step has its
      // own ceiling so the hierarchy survives at maximum size — see
      // theme/maxFontScale. A caller can still override per instance.
      maxFontSizeMultiplier={maxFontScale[variant]}
      {...rest}
      style={[
        preset,
        { color },
        // Text alignment always follows the LANGUAGE, not the (possibly stale)
        // native direction. On iOS an explicit 'left'/'right' interacts with
        // the RTL left↔right swap differently depending on the container the
        // text ends up in (the home greeting vs the hero card resolve
        // opposite ways), so iOS gets NO explicit textAlign: the paragraph's
        // base `writingDirection` drives natural alignment, which is
        // deterministic everywhere — Arabic → right, Latin languages → left,
        // even for Latin fragments ("Medn", "MRU 0") inside an Arabic UI.
        // Android has no writingDirection: keep explicit physical alignment
        // (the left↔right swap is disabled at boot, see initI18n).
        // Placed before `align` and `style` so an explicit override still wins.
        isArabic
          ? Platform.OS === 'ios'
            ? { writingDirection: 'rtl' as const }
            : { textAlign: 'right' as const, writingDirection: 'rtl' as const }
          : I18nManager.isRTL
            ? Platform.OS === 'ios'
              ? { writingDirection: 'ltr' as const }
              : { textAlign: 'left' as const, writingDirection: 'ltr' as const }
            : null,
        align ? { textAlign: align } : null,
        tracking != null ? { letterSpacing: tracking } : null,
        style,
        // Arabic: force the weight-matched Cairo face (Sora can't render Arabic)
        // and kill letterSpacing. Applied LAST so it wins over any caller
        // `style.fontFamily` — including a Sora face passed only to set a weight.
        // letterSpacing on iOS is applied as CoreText kerning and breaks Arabic
        // shaping (i'jam dots drop, joined letters split); textTransform is moot.
        // The raised lineHeight keeps Cairo's high dots inside the line box
        // instead of overlapping whatever sits above the text.
        isArabic
          ? {
              fontFamily: arFace,
              letterSpacing: 0,
              textTransform: 'none' as const,
              lineHeight: arabicLineHeight(style, preset.fontSize, preset.lineHeight),
            }
          : null,
      ]}
    >
      {children}
    </RNText>
  );
}
