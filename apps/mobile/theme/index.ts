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
  // `danger` is tuned to be read on sand; on espresso it goes muddy. This is
  // the error voice for dark surfaces — the family needed one.
  onEspressoDanger: '#F4A99A',

  // Semantic.
  success: '#3E9C5F', // validated / completed (used sparingly)
  successSoft: '#E2F2E6',
  danger: '#D6452F', // logout, errors (warm red, harmonizes w/ orange)
  dangerSoft: '#FBE3DC',
  dangerDeep: '#4A150C', // dark red SURFACE (overtime, alarm cards)
  warning: '#E8920E',
  // The one cool hue in the palette, reserved for water (flood reports). It is
  // desaturated on purpose so it reads as a category marker next to the ember,
  // not as a second brand colour.
  water: '#1F7A8C',

  // Universal.
  white: '#FFFFFF',
  black: '#000000',
  onEmber: '#FFFFFF', // text on the orange CTA
} as const;

/**
 * Warm, tinted shadow color — never pure black (that's what looks cheap).
 * Exported because sheets anchored to an edge have to aim their shadow by hand
 * and must still use THIS tint rather than inventing one.
 */
export const SHADOW = '#5A3414';

/**
 * Demand heatmap ramp — hot to cold, but staying inside the warm palette so a
 * dense map doesn't turn into a different product. Single source of truth: the
 * cluster fill and the legend both read from here, which is how they stay in
 * agreement (they used to each carry their own copy of the three hex values).
 */
export const heat = {
  high: '#B41812',
  mid: '#E84620',
  low: '#FFA532',
} as const;

/* ------------------------------------------------------------------ *
 *  Status tones — tinted background + readable foreground pairs.
 *
 *  Every list screen used to carry its own status→colour table, inherited
 *  from the pre-"Sahara Solaire" design: Tailwind blues for "searching",
 *  indigos for "accepted", emerald for "completed". Six screens, six
 *  different stories, none of them the brand's. This is the one table.
 *
 *  Pick by MEANING, not by colour:
 *    neutral  — nothing is happening / archived / not applicable
 *    pending  — waiting on someone (the user, an admin, a captain)
 *    active   — happening right now; this is the brand's own ember
 *    done     — finished successfully
 *    failed   — cancelled, rejected, expired
 *    accent   — a category that must NOT be confused with the above
 *               (currently: convoyage rides among ordinary ones)
 * ------------------------------------------------------------------ */

export const statusTone = {
  neutral: { bg: '#F7EEDF', fg: '#6B5740' },
  pending: { bg: '#FCEFC9', fg: '#9A6711' },
  active:  { bg: '#FDEAD9', fg: '#D9531B' },
  done:    { bg: '#E2F2E6', fg: '#2F7A49' },
  failed:  { bg: '#FBE3DC', fg: '#B5391F' },
  accent:  { bg: '#EDE6F7', fg: '#6D3FA8' },
} as const;

export type StatusToneName = keyof typeof statusTone;

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
  // Deep sand — the splash wash, canvas sinking into dune shadow.
  sand: ['#FBF3E7', '#F6E4C8', '#EDCFA6', '#D4A76A'] as const,
  // Live recording — a hotter, redder ember so "armed" never reads as "idle".
  recording: ['#E5604A', '#D6452F'] as const,
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
  /** Chips, inset rows, small bordered blocks living inside a card. */
  xs: 8,
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
  // Arabic — Cairo. Geometric, pairs with Sora, and matches the brand
  // marketing typography. Applied for ar/hs by <AppText>; Sora has no Arabic
  // glyphs so this is what actually renders Arabic UI text.
  arabic: {
    regular: 'Cairo_400Regular',
    medium: 'Cairo_500Medium',
    semibold: 'Cairo_600SemiBold',
    bold: 'Cairo_700Bold',
    extrabold: 'Cairo_800ExtraBold',
  },
  mono: 'Sora_600SemiBold',
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
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: fonts.text.regular,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
    letterSpacing: -0.1,
  },
  bodyStrong: {
    fontFamily: fonts.text.semibold,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  // Below ~14pt the letters start to crowd rather than sprawl, so tracking
  // crosses zero and goes slightly POSITIVE — the mirror of what the display
  // sizes need. A single letter-spacing value for the whole ramp is always
  // wrong at one end or the other.
  label: {
    fontFamily: fonts.text.semibold,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
    letterSpacing: 0.05,
  },
  caption: {
    fontFamily: fonts.text.medium,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    letterSpacing: 0.15,
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
 *  Motion
 *
 *  Springs are described by RESPONSE (roughly how long it takes to reach the
 *  target, in seconds — lower is snappier) and DAMPING RATIO (1 = arrives and
 *  stops; below 1 overshoots and springs back). Those two numbers are the ones
 *  you can reason about; `springConfig()` in lib/motion.ts turns them into the
 *  stiffness/damping/mass triplet Animated.spring actually wants.
 *
 *  The house default is critically damped — damping ratio 1, no overshoot.
 *  Bounce is EARNED, not decorative: it belongs only where the user's own
 *  gesture carried momentum (a flick, a throw, a drag release). A menu that
 *  merely appeared and then wobbles reads as a toy.
 * ------------------------------------------------------------------ */

export const spring = {
  /** Press feedback — must feel instantaneous, so the response is very short. */
  press: { response: 0.22, dampingRatio: 1 },
  /** Something appearing on its own: entrances, reveals, layout settles. */
  enter: { response: 0.4, dampingRatio: 1 },
  /** Repositioning an existing object (Apple's own picture-in-picture values). */
  move: { response: 0.4, dampingRatio: 1 },
  /** A sheet/drawer settling after a drag — the flick earns the bounce. */
  sheet: { response: 0.3, dampingRatio: 0.8 },
  /** Anything thrown by a flick and landing on a snap point. */
  flick: { response: 0.4, dampingRatio: 0.8 },
} as const;

export const motion = {
  spring,
  // Durations (ms) — for cross-fades and non-interactive reveals only. Anything
  // a finger can touch gets a spring instead, because a fixed duration can't
  // respond to the user changing their mind halfway through.
  fast: 140,
  base: 240,
  slow: 420,
  /** How far a control dips under the thumb. */
  pressScale: 0.96,
  /** Cross-fade used in place of travel when Reduce Motion is on. */
  reducedFade: 160,
} as const;

/* Font assets to feed `useFonts` in the root layout. */
export { default as fontAssets, latinFontAssets, arabicFontAssets } from './fontAssets';

export const theme = {
  colors, gradients, statusTone, heat, spacing, radius, shadow, type, fonts, motion, spring,
} as const;
export type Theme = typeof theme;
