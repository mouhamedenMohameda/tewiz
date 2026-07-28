/**
 * Font assets fed to expo-font in the root layout. Sora for Latin/UI,
 * Amiri for calligraphic Arabic (slogan / branding).
 */

import {
  Sora_400Regular,
  Sora_500Medium,
  Sora_600SemiBold,
  Sora_700Bold,
  Sora_800ExtraBold,
} from '@expo-google-fonts/sora';
import {
  Amiri_400Regular,
  Amiri_700Bold,
} from '@expo-google-fonts/amiri';

export const latinFontAssets = {
  Sora_400Regular,
  Sora_500Medium,
  Sora_600SemiBold,
  Sora_700Bold,
  Sora_800ExtraBold,
  Amiri_400Regular,
  Amiri_700Bold,
};

const fontAssets = { ...latinFontAssets };

export default fontAssets;
