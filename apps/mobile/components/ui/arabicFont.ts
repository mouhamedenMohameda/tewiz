/**
 * Arabic font resolution shared by <AppText> and <PlainText>.
 *
 * Sora (the Latin UI font) has no Arabic glyphs, so ar/hs text must render in
 * Cairo. Callers usually express a weight either as a Sora face name or a
 * `fontWeight` in their style — we translate both to the matching Cairo face.
 */

import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { fonts } from '@/theme';

type ArabicWeight = keyof typeof fonts.arabic; // regular | medium | semibold | bold | extrabold

const WEIGHT_TO_ARABIC: Record<string, ArabicWeight> = {
  '400': 'regular',
  '500': 'medium',
  '600': 'semibold',
  '700': 'bold',
  '800': 'extrabold',
  '900': 'extrabold',
};

const SORA_FACE_TO_ARABIC: Record<string, ArabicWeight> = {
  Sora_400Regular: 'regular',
  Sora_500Medium: 'medium',
  Sora_600SemiBold: 'semibold',
  Sora_700Bold: 'bold',
  Sora_800ExtraBold: 'extrabold',
};

/**
 * Resolve the Cairo face to use for Arabic text, honoring the weight the caller
 * asked for (via a Sora `fontFamily`, a `fontWeight`, or an explicit fallback).
 */
export function arabicFaceForStyle(
  style: StyleProp<TextStyle>,
  fallbackWeight?: TextStyle['fontWeight'],
): string {
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  if (flat?.fontFamily) {
    const k = SORA_FACE_TO_ARABIC[flat.fontFamily as string];
    if (k) return fonts.arabic[k];
  }
  if (flat?.fontWeight != null) {
    const k = WEIGHT_TO_ARABIC[String(flat.fontWeight)];
    if (k) return fonts.arabic[k];
  }
  if (fallbackWeight != null) {
    const k = WEIGHT_TO_ARABIC[String(fallbackWeight)];
    if (k) return fonts.arabic[k];
  }
  return fonts.arabic.regular;
}

/**
 * Cairo's vertical metrics are much taller than Sora's: the i'jam dots sit
 * high above the x-height. With the presets' tight (Sora-tuned) lineHeights,
 * iOS lets the glyph tops overflow the line box, so the dots of e.g. «متصل»
 * visually collide with whatever sits above the text. Give Arabic lines at
 * least this factor of headroom.
 */
const ARABIC_LINE_HEIGHT_FACTOR = 1.6;

/**
 * Line height to use for Arabic text: the declared one, raised to the Cairo
 * minimum. Returns undefined when no lineHeight is declared anywhere — the
 * font's natural metrics apply then and never clip.
 */
export function arabicLineHeight(
  style: StyleProp<TextStyle>,
  presetSize?: number,
  presetLineHeight?: number,
): number | undefined {
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  const declared = flat?.lineHeight ?? presetLineHeight;
  if (declared == null) return undefined;
  const size = flat?.fontSize ?? presetSize ?? 14;
  return Math.max(declared, Math.ceil(size * ARABIC_LINE_HEIGHT_FACTOR));
}
