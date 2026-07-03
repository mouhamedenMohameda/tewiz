/**
 * Tewiz design system — "Sahara Solaire".
 *
 * A warm, sunlit identity built on terracotta orange, marigold gold and
 * espresso ink over a sand canvas. Replaces the previous cold slate + flat
 * green look. Every color, radius, shadow and type ramp lives here so the
 * whole app stays coherent and is themeable from one place.
 *
 * Usage:
 *   import { colors, spacing, radius, shadow, type, gradients } from '@/theme';
 */

import { Platform } from 'react-native';

/* ------------------------------------------------------------------ *
 *  Color
 * ------------------------------------------------------------------ */

export const colors = {
  // Surfaces — warm, never a clinical white.
  canvas: '#FBF3E7', // app background — warm sand
  canvasDeep: '#F4E7D2', // section wells / scroll overscroll
  surface: '#FFFCF6', // cards — warm white
  surfaceAlt: '#F7EEDF', // chips, inset rows, subtle raised
  sunken: '#F3E8D6', // inputs, track backgrounds

  // Brand — the sun.
  ember: '#F2682C', // primary orange (CTA, brand)
  emberDeep: '#D9531B', // pressed / strong
  emberSoft: '#FDEAD9', // tinted ember background
  sun: '#F6A623', // marigold gold (secondary)
  saffron: '#FBC65A', // light gold (gradient stop, highlights)
  saffronSoft: '#FCEFC9', // tinted gold background

  // Ink — warm espresso neutrals (replaces cold slate).
  ink: '#2C1D10', // primary text / near-black
  ink2: '#6B5740', // secondary text
  muted: '#9C886E', // tertiary text, inactive icons
  faint: '#BCA98E', // placeholders, disabled
  line: '#ECDFCB', // hairline borders / dividers
  lineStrong: '#E1CFB2', // stronger borders

  // Espresso surface — the "night" counterpart used for hero/invite cards.
  espresso: '#2A1A0E',
  espressoAlt: '#3A2615',
  onEspresso: '#FBEFDD', // text on espresso
  onEspressoMuted: '#C9B49A',

  // Semantic.
  success: '#3E9C5F', // validated / completed (used sparingly)
  successSoft: '#E2F2E6',
  danger: '#D6452F', // logout, errors (warm red, harmonizes w/ orange)
  dangerSoft: '#FBE3DC',
  warning: '#E8920E',

  // Universal.
  white: '#FFFFFF',
  black: '#000000',
  onEmber: '#FFFFFF', // text on the orange CTA
} as const;

/** Warm, tinted shadow color — never pure black (that's what looks cheap). */
const SHADOW = '#5A3414';

/* ------------------------------------------------------------------ *
 *  Gradients (expo-linear-gradient `colors` arrays)
 * ------------------------------------------------------------------ */

export const gradients = {
  // Primary CTA — sunset orange into marigold.
  ember: ['#F8843E', '#F2682C', '#E85617'] as const,
  // Hero — golden hour sky.
  sunrise: ['#FBC65A', '#F58A2B', '#EC6A1F'] as const,
  // Espresso invite card — warm dark with a faint glow at top.
  espresso: ['#3C2716', '#2A1A0E'] as const,
  // Soft sand wash for headers.
  dawn: ['#FCF6EC', '#F7EBD7'] as const,
} as const;

/* ------------------------------------------------------------------ *
 *  Spacing — 4pt rhythm
 * ------------------------------------------------------------------ */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  huge: 40,
  mega: 56,
} as const;

/* ------------------------------------------------------------------ *
 *  Radius — generous, friendly rounding
 * ------------------------------------------------------------------ */

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 30,
  pill: 999,
} as const;

/* ------------------------------------------------------------------ *
 *  Shadows — warm-tinted elevation. Cross-platform (iOS + Android).
 * ------------------------------------------------------------------ */

export const shadow = {
  none: {},
  // Resting card.
  card: {
    shadowColor: SHADOW,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  // Floating / hero surfaces.
  raised: {
    shadowColor: SHADOW,
    shadowOpacity: 0.16,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 9,
  },
  // Primary CTA — an ember-tinted glow.
  ember: {
    shadowColor: '#E8541A',
    shadowOpacity: 0.42,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
} as const;

/* ------------------------------------------------------------------ *
 *  Typography
 *
 *  Custom fonts in RN are addressed by family-per-weight (fontWeight is
 *  ignored once a custom fontFamily is set). We keep a matching fontWeight
 *  too so that, if the fonts ever fail to load, the system fallback still
 *  renders the right weight.
 * ------------------------------------------------------------------ */

export const fonts = {
  // Display — Sora (geometric, characterful) for headings & big numbers.
  display: {
    regular: 'Sora_400Regular',
    medium: 'Sora_500Medium',
    semibold: 'Sora_600SemiBold',
    bold: 'Sora_700Bold',
    extrabold: 'Sora_800ExtraBold',
  },
  // Text — Sora for Latin scripts.
  text: {
    regular: 'Sora_400Regular',
    medium: 'Sora_500Medium',
    semibold: 'Sora_600SemiBold',
    bold: 'Sora_700Bold',
    extrabold: 'Sora_800ExtraBold',
  },
  // Arabic display & text — Louguiya (Mauritanian, bundled local TTFs).
  // Louguiya ships only Regular + Bold, so the mid/heavy weights collapse onto
  // them: 400/500 → Regular, 600/700/800 → Bold.
  arabic: {
    regular: 'Louguiya_400Regular',
    medium: 'Louguiya_400Regular',
    semibold: 'Louguiya_700Bold',
    bold: 'Louguiya_700Bold',
    extrabold: 'Louguiya_700Bold',
  },
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
} as const;

export type TypePreset = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700' | '800';
  letterSpacing?: number;
  textTransform?: 'none' | 'uppercase';
};

export const type = {
  /** Hero numbers / splash wordmark. */
  hero: {
    fontFamily: fonts.display.extrabold,
    fontSize: 40,
    lineHeight: 44,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  display: {
    fontFamily: fonts.display.bold,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  h1: {
    fontFamily: fonts.display.bold,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  h2: {
    fontFamily: fonts.display.semibold,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  title: {
    fontFamily: fonts.text.bold,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
  },
  body: {
    fontFamily: fonts.text.regular,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
  },
  bodyStrong: {
    fontFamily: fonts.text.semibold,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  label: {
    fontFamily: fonts.text.semibold,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
  },
  caption: {
    fontFamily: fonts.text.medium,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  /** All-caps eyebrow. */
  overline: {
    fontFamily: fonts.text.bold,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
} satisfies Record<string, TypePreset>;

/* ------------------------------------------------------------------ *
 *  Motion — spring & timing presets used across animated primitives.
 * ------------------------------------------------------------------ */

export const motion = {
  // Press feedback spring (react-native-reanimated withSpring config).
  press: { damping: 18, stiffness: 320, mass: 0.6 },
  // Gentle entrance spring.
  enter: { damping: 16, stiffness: 140, mass: 0.9 },
  // Durations (ms).
  fast: 140,
  base: 240,
  slow: 420,
  pressScale: 0.96,
} as const;

/* Font assets to feed `useFonts` in the root layout. Split by script so the
 * boot only waits on the fonts the boot language needs (see ./fontAssets). */
export { default as fontAssets, latinFontAssets, arabicFontAssets } from './fontAssets';

export const theme = { colors, gradients, spacing, radius, shadow, type, fonts, motion } as const;
export type Theme = typeof theme;
