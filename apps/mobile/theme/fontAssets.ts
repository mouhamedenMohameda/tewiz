/**
 * Font assets fed to expo-font in the root layout.
 *
 * Two families, both load-bearing for the UI:
 *   - Sora  — Latin/UI text (fr, en, and the numerals everywhere).
 *   - Cairo — Arabic text (ar, hs). Sora has NO Arabic glyphs, so every
 *             Arabic string in the app renders in Cairo, chosen per weight by
 *             `components/ui/arabicFont.ts`.
 *
 * History (2026-08): Cairo was referenced by the theme, <AppText>, <PlainText>,
 * <TextField>, <SelectField> and the splash — but was never passed to
 * `useFonts`, so it silently never loaded. Every Arabic string fell back to the
 * system font, and `arabicLineHeight()`'s headroom (tuned for Cairo's tall
 * i'jam dots) was being applied to a font with different metrics. Arabic is an
 * official language here, so this was half the UI. Both families are now
 * loaded before first paint.
 *
 * Amiri used to be loaded here for "calligraphic Arabic (slogan / branding)"
 * but no code ever referenced either face — it was two font files parsed on
 * every cold start for nothing. Removed. If a calligraphic display face is
 * wanted later, add it back AND wire it to a real style.
 */

import {
  Sora_400Regular,
  Sora_500Medium,
  Sora_600SemiBold,
  Sora_700Bold,
  Sora_800ExtraBold,
} from '@expo-google-fonts/sora';
import {
  Cairo_400Regular,
  Cairo_500Medium,
  Cairo_600SemiBold,
  Cairo_700Bold,
  Cairo_800ExtraBold,
} from '@expo-google-fonts/cairo';

/** Latin/UI faces — Sora. */
export const latinFontAssets = {
  Sora_400Regular,
  Sora_500Medium,
  Sora_600SemiBold,
  Sora_700Bold,
  Sora_800ExtraBold,
};

/** Arabic faces — Cairo. Weight names mirror the Sora ramp 1:1. */
export const arabicFontAssets = {
  Cairo_400Regular,
  Cairo_500Medium,
  Cairo_600SemiBold,
  Cairo_700Bold,
  Cairo_800ExtraBold,
};

const fontAssets = { ...latinFontAssets, ...arabicFontAssets };

export default fontAssets;
