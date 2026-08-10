/**
 * "Sahara Solaire" — the two palettes.
 *
 * The dark scheme is NOT the light one inverted. Inverting a warm palette
 * produces a cold one, and the whole identity here is warmth: sand, terracotta,
 * espresso. So dark mode is the same desert at night — deep roasted browns
 * rather than neutral greys, and never pure black, which would read as a
 * different product that happens to share an icon.
 *
 * Three rules the dark values follow, all of them about how the eye actually
 * works rather than about arithmetic:
 *
 *  1. SATURATED BRAND COLOURS BURN ON DARK. The ember that reads as confident
 *     on sand glares against espresso, and its edges shimmer. Dark ember is
 *     lifted in luminance and pulled back in saturation so it stays the same
 *     colour without shouting.
 *  2. ELEVATION INVERTS. On light, a raised surface gets a shadow; on dark, a
 *     shadow is invisible, so raised surfaces get LIGHTER instead. `surface` is
 *     above `canvas`, not below it — that is why the dark values climb where
 *     the light ones descend.
 *  3. TINTED BACKGROUNDS CANNOT JUST DARKEN. `emberSoft` is a pale wash on
 *     light; on dark it becomes a low-luminance, still-saturated ember so the
 *     tint remains legible as "ember" rather than collapsing into the canvas.
 *
 * Every key exists in both palettes — that is enforced by the type, so a colour
 * added to one and forgotten in the other will not compile.
 */

export interface Palette {
  canvas: string;
  canvasDeep: string;
  surface: string;
  surfaceAlt: string;
  sunken: string;

  ember: string;
  emberDeep: string;
  emberSoft: string;
  sun: string;
  saffron: string;
  saffronSoft: string;

  ink: string;
  ink2: string;
  muted: string;
  faint: string;
  line: string;
  lineStrong: string;

  espresso: string;
  espressoAlt: string;
  onEspresso: string;
  onEspressoMuted: string;
  onEspressoDanger: string;

  success: string;
  successSoft: string;
  danger: string;
  dangerSoft: string;
  dangerDeep: string;
  warning: string;
  water: string;

  white: string;
  black: string;
  onEmber: string;
}

export const light: Palette = {
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
  onEspresso: '#FBEFDD',
  onEspressoMuted: '#C9B49A',
  onEspressoDanger: '#F4A99A',

  // Semantic.
  success: '#3E9C5F',
  successSoft: '#E2F2E6',
  danger: '#D6452F',
  dangerSoft: '#FBE3DC',
  dangerDeep: '#4A150C',
  warning: '#E8920E',
  water: '#1F7A8C',

  // Universal.
  white: '#FFFFFF',
  black: '#000000',
  onEmber: '#FFFFFF',
};

export const dark: Palette = {
  // Surfaces climb rather than descend — see rule 2. Roasted, not grey: there
  // is red and yellow left in every one of these.
  canvas: '#150D06', // app background — the desert at night
  canvasDeep: '#0E0804', // wells sink BELOW the canvas, same as on light
  surface: '#211408', // cards — lifted off the canvas by light, not by shadow
  surfaceAlt: '#2C1C0E', // chips, inset rows
  sunken: '#0F0904', // inputs read as cut INTO the surface

  // Brand — same hue, lifted and calmed so it stops glaring. Note emberDeep is
  // LIGHTER than ember here: "pressed/strong" has to move toward the light on a
  // dark ground, because moving away from it is how you disappear.
  ember: '#FF8348',
  emberDeep: '#FF9A66',
  emberSoft: '#42200F', // a dark ember wash, still unmistakably ember
  sun: '#F9B443',
  saffron: '#FCD07A',
  saffronSoft: '#3A2A0C',

  // Ink inverts into the cream family. Not white: pure white on warm dark
  // vibrates and looks blue by contrast.
  ink: '#F7EADA', // primary text
  ink2: '#C4AC8F', // secondary
  muted: '#8F7A5F', // tertiary, inactive icons
  faint: '#6B5A45', // placeholders, disabled
  line: '#33230F', // hairlines — separation by lightness, not by shadow
  lineStrong: '#4A3418',

  // The espresso card was already the dark surface of the light theme. In dark
  // mode it can no longer distinguish itself by being dark, so it goes the
  // other way and becomes the LIGHTEST card in the app.
  espresso: '#3A2615',
  espressoAlt: '#4A3320',
  onEspresso: '#FBEFDD',
  onEspressoMuted: '#C9B49A',
  onEspressoDanger: '#F4A99A',

  // Semantic — lifted for contrast against a dark ground, softs inverted into
  // deep tints that still carry their hue.
  success: '#5EC77F',
  successSoft: '#14301C',
  danger: '#FF6E55',
  dangerSoft: '#3A150D',
  dangerDeep: '#2A0C06',
  warning: '#F5A929',
  water: '#3EA5B9',

  white: '#FFFFFF',
  black: '#000000',
  // The CTA label INVERTS in dark mode. Rule 1 lifts the ember so it stops
  // glaring, and a lifted ember is too bright to carry white text — measured at
  // 2.4:1, worse than the light theme's 3.2:1. So the dark-mode button becomes
  // a light accent with dark text, which is what the contrast maths demands
  // rather than what symmetry would suggest.
  onEmber: '#2A1206',
};

export type SchemeName = 'light' | 'dark';

export const palettes: Record<SchemeName, Palette> = { light, dark };
