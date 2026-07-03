/**
 * Font assets fed to expo-font in the root layout.
 *
 * Split by script so a cold start only blocks the splash on the fonts the
 * *boot language* actually needs. A French/Latin session never renders
 * Louguiya — AppText only reaches for the Arabic family when the language is
 * `ar`/`hs`, and switching layout direction requires an app restart anyway —
 * so its files are kept off the critical path and loaded lazily, only when
 * the app boots in Arabic. See app/_layout.tsx.
 *
 * Keeping the require()s isolated here keeps `theme/index.ts` side-effect free.
 */

import {
  Sora_400Regular,
  Sora_500Medium,
  Sora_600SemiBold,
  Sora_700Bold,
  Sora_800ExtraBold,
} from '@expo-google-fonts/sora';

/** Latin (Sora) — always loaded at boot; the base + fallback family. */
export const latinFontAssets = {
  Sora_400Regular,
  Sora_500Medium,
  Sora_600SemiBold,
  Sora_700Bold,
  Sora_800ExtraBold,
};

/**
 * Arabic (Louguiya) — bundled local TTFs, only loaded when the app boots in
 * `ar`/`hs`. Louguiya ships two weights (Regular, Bold); the theme maps the
 * intermediate weights onto these two. See theme/index.ts `fonts.arabic`.
 */
export const arabicFontAssets = {
  Louguiya_400Regular: require('@/assets/fonts/Louguiya-Regular.ttf'),
  Louguiya_700Bold: require('@/assets/fonts/Louguiya-Bold.ttf'),
};

/** Every family, eagerly — kept for any consumer that wants the full set. */
const fontAssets = { ...latinFontAssets, ...arabicFontAssets };

export default fontAssets;
