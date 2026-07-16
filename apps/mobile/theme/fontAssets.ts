/**
 * Font assets fed to expo-font in the root layout.
 *   - Sora   → Latin / UI text (headings, body, numbers).
 *   - Cairo  → Arabic UI text (ar / hs). Geometric, pairs with Sora, and
 *              matches the brand marketing typography. Replaces the previous
 *              system-font fallback that Arabic used to render in.
 *   - Amiri  → calligraphic Arabic used only for the splash slogan / branding.
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
import {
  Amiri_400Regular,
  Amiri_700Bold,
} from '@expo-google-fonts/amiri';

/** Latin / UI faces. */
export const latinFontAssets = {
  Sora_400Regular,
  Sora_500Medium,
  Sora_600SemiBold,
  Sora_700Bold,
  Sora_800ExtraBold,
};

/** Arabic faces — Cairo for UI, Amiri for the calligraphic branding slogan. */
export const arabicFontAssets = {
  Cairo_400Regular,
  Cairo_500Medium,
  Cairo_600SemiBold,
  Cairo_700Bold,
  Cairo_800ExtraBold,
  Amiri_400Regular,
  Amiri_700Bold,
};

const fontAssets = { ...latinFontAssets, ...arabicFontAssets };

export default fontAssets;
