/**
 * Tewiz design system — "Sahara Solaire".
 *
 * A warm, sunlit identity built on terracotta orange, marigold gold and
 * espresso ink over a sand canvas. Every colour, radius, shadow and type ramp
 * lives here so the whole app stays coherent and is themeable from one place.
 *
 * Usage:
 *   import { colors, spacing, radius, shadow, type, gradients } from '@/theme';
 *
 * LIGHT AND DARK
 * --------------
 * `colors` (and every colour-bearing token below) is a live view onto the
 * ACTIVE palette rather than a frozen set of hex strings: each key is a getter
 * that reads from whichever scheme is current. That is what lets ~1400 existing
 * `colors.x` call sites gain dark mode without being touched.
 *
 * The values are precomputed once per scheme, so a read costs one property
 * indirection, not a rebuild.
 *
 * THE ONE RULE FOR CALLERS: never destructure or snapshot these at module
 * scope. `const BG = colors.canvas` at the top of a file captures whichever
 * scheme happened to be active at import time and then never changes again.
 * If you need a module-level table of colours, wrap it in `schemed()`.
 */

import { palettes, type Palette, type SchemeName } from './palette';

export type { Palette, SchemeName };
export { palettes } from './palette';

/* ------------------------------------------------------------------ *
 *  Active scheme
 * ------------------------------------------------------------------ */

let active: SchemeName = 'light';

export function currentScheme(): SchemeName {
  return active;
}

/**
 * Swap the active palette. Called by <ThemeProvider> from the OS setting —
 * screens never call this themselves.
 */
export function setScheme(next: SchemeName): void {
  active = next;
}

/**
 * Build a token table once per scheme and expose it as getters onto the active
 * one. `build` may read `colors` freely: it is run once under each scheme.
 *
 * Use it for any module-level constant that mentions a colour — a status→tint
 * table, a category palette — since a plain object literal there would freeze
 * the scheme that was active when the file was first imported.
 *
 *   const STATUS_TINT = schemed(() => ({
 *     pending: { bg: colors.saffronSoft, fg: colors.warning },
 *   }));
 */
export function schemed<T extends object>(build: () => T): T {
  const previous = active;
  const cache = {} as Record<SchemeName, T>;
  for (const scheme of ['light', 'dark'] as const) {
    active = scheme;
    cache[scheme] = build();
  }
  active = previous;

  const view = {} as T;
  for (const key of Object.keys(cache.light) as (keyof T)[]) {
    Object.defineProperty(view, key, {
      get: () => cache[active][key],
      enumerable: true,
    });
  }
  return view;
}

/** `schemed` for tables derived directly from the palette. */
function fromPalette<T extends object>(build: (p: Palette) => T): T {
  return schemed(() => build(palettes[active]));
}

/* ------------------------------------------------------------------ *
 *  Color
 * ------------------------------------------------------------------ */

export const colors: Palette = fromPalette((p) => p);

/**
 * Warm, tinted shadow colour — never pure black (that's what looks cheap).
 * Exported because sheets anchored to an edge have to aim their shadow by hand
 * and must still use THIS tint rather than inventing one.
 *
 * On dark it goes to true black: a brown shadow over a brown canvas is
 * invisible, and on dark surfaces separation comes from LIGHT (see the
 * palette's rule 2) with the shadow only deepening the gap beneath.
 */
export const shadowTint = schemed(() => ({
  // NOT named `value`. The react-native-worklets babel plugin rewrites every
  // `<expr>.value` it finds inside a style object into a Reanimated dev-warning
  // that require()s react-native-reanimated — which nothing in this app pulls
  // in, so the require lands undefined and the component crashes at render.
  // Typecheck and the node tests both pass right through it; it only shows up
  // on device. Keep style-facing token keys off the name `value`.
  color: active === 'dark' ? '#000000' : '#5A3414',
})) as { color: string };


/**
 * Demand heatmap ramp — hot to cold, but staying inside the warm palette so a
 * dense map doesn't turn into a different product. Single source of truth: the
 * cluster fill and the legend both read from here, which is how they stay in
 * agreement (they used to each carry their own copy of the three hex values).
 */
export const heat = schemed(() => (active === 'dark'
  ? { high: '#FF5A4E', mid: '#FF8A46', low: '#FFC46B' }
  : { high: '#B41812', mid: '#E84620', low: '#FFA532' }
));

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

export const statusTone = schemed(() => (active === 'dark'
  // Dark: the tint becomes a deep wash and the foreground lifts, so the pair
  // keeps its meaning and its contrast instead of merely getting darker.
  ? {
      neutral: { bg: '#2C1C0E', fg: '#C4AC8F' },
      pending: { bg: '#3A2A0C', fg: '#F2C15C' },
      active:  { bg: '#42200F', fg: '#FF9A66' },
      done:    { bg: '#14301C', fg: '#6FD292' },
      failed:  { bg: '#3A150D', fg: '#FF8770' },
      accent:  { bg: '#241B36', fg: '#B392E4' },
    }
  : {
      neutral: { bg: '#F7EEDF', fg: '#6B5740' },
      pending: { bg: '#FCEFC9', fg: '#9A6711' },
      active:  { bg: '#FDEAD9', fg: '#D9531B' },
      done:    { bg: '#E2F2E6', fg: '#2F7A49' },
      failed:  { bg: '#FBE3DC', fg: '#B5391F' },
      accent:  { bg: '#EDE6F7', fg: '#6D3FA8' },
    }
));

export type StatusToneName = keyof typeof statusTone;

/* ------------------------------------------------------------------ *
 *  Gradients (expo-linear-gradient `colors` arrays)
 * ------------------------------------------------------------------ */

export type GradientName = 'ember' | 'sunrise' | 'espresso' | 'dawn' | 'sand' | 'recording';

export const gradients = schemed(() => (active === 'dark'
  ? {
      // The CTA keeps its shape but sits in the dark ember range, so it reads
      // as the same button rather than as a light-mode button left on.
      ember: ['#FF9257', '#FF8348', '#F06A2C'],
      sunrise: ['#FCD07A', '#F9A040', '#E8752A'],
      // On dark, the espresso card can no longer stand out by being darker —
      // so this gradient inverts and lifts (see the palette's rule 2).
      espresso: ['#4A3320', '#3A2615'],
      // The header wash sinks instead of glowing.
      dawn: ['#1D1209', '#150D06'],
      sand: ['#150D06', '#20140A', '#2C1C0E', '#3A2615'],
      recording: ['#FF7A63', '#E85440'],
    }
  : {
      // Primary CTA — sunset orange into marigold.
      ember: ['#F8843E', '#F2682C', '#E85617'],
      // Hero — golden hour sky.
      sunrise: ['#FBC65A', '#F58A2B', '#EC6A1F'],
      // Espresso invite card — warm dark with a faint glow at top.
      espresso: ['#3C2716', '#2A1A0E'],
      // Soft sand wash for headers.
      dawn: ['#FCF6EC', '#F7EBD7'],
      // Deep sand — the splash wash, canvas sinking into dune shadow.
      sand: ['#FBF3E7', '#F6E4C8', '#EDCFA6', '#D4A76A'],
      // Live recording — a hotter, redder ember so "armed" never reads as "idle".
      recording: ['#E5604A', '#D6452F'],
    }
)) as Record<GradientName, readonly [string, string, ...string[]]>;

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

export const shadow = schemed(() => ({
  none: {},
  // Resting card.
  card: {
    shadowColor: shadowTint.color,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  // Floating / hero surfaces.
  raised: {
    shadowColor: shadowTint.color,
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
}));

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
 *  Dynamic Type — how far each ramp step may grow.
 *
 *  React Native scales text with the OS setting by default, and on iOS the
 *  accessibility sizes go past 300%. Left uncapped, a 40pt hero becomes 124pt
 *  and takes the screen hostage; worse, EVERY step hits the same ceiling, so
 *  the hierarchy the ramp exists to express collapses into one undifferentiated
 *  size.
 *
 *  So the cap is per step, and it is inverse to the size: small text — the text
 *  someone actually turned this setting on to read — gets the most headroom,
 *  and display sizes, which are already large and are doing a job of hierarchy
 *  rather than of reading, get the least. That is the same compression Apple's
 *  own Dynamic Type ramp applies, and it is what keeps a caption and a title
 *  still looking like a caption and a title at maximum size.
 * ------------------------------------------------------------------ */

export const maxFontScale = {
  hero: 1.3,
  display: 1.3,
  h1: 1.4,
  h2: 1.4,
  title: 1.6,
  body: 1.8,
  bodyStrong: 1.8,
  label: 1.9,
  caption: 2,
  overline: 2,
} as const satisfies Record<keyof typeof type, number>;

/** Fallback for <PlainText>, which carries no ramp step to look up. */
export const DEFAULT_MAX_FONT_SCALE = 1.8;

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

/*
 * Font BINARIES deliberately do NOT live behind this module. Re-exporting them
 * here dragged @expo-google-fonts — and through it the whole React Native
 * runtime — into anything that wanted a colour or a spacing value, which meant
 * the design tokens could not be reasoned about (or tested) on their own.
 * The root layout imports them straight from '@/theme/fontAssets'.
 */

export const theme = {
  colors, gradients, statusTone, heat, spacing, radius, shadow, type, fonts, motion, spring,
} as const;
export type Theme = typeof theme;
