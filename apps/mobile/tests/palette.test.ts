/**
 * A dark palette is where a design system quietly breaks: every pair still
 * "looks fine" in isolation, and it is only on a real screen, in real light,
 * that you discover the secondary text has vanished into the card behind it.
 *
 * Contrast is arithmetic, so it gets tested rather than eyeballed. These check
 * the pairs the app actually renders — a foreground and the surface it sits on
 * — against WCAG ratios, in BOTH schemes.
 */

import { describe, expect, it } from 'vitest';
import { colors, currentScheme, schemed, setScheme, statusTone } from '@/theme';
import { dark, light, type Palette } from '@/theme/palette';

/* ---------------------------------------------------------------- *
 *  WCAG relative luminance / contrast ratio
 * ---------------------------------------------------------------- */

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}

function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a! + 0.05) / (b! + 0.05);
}

/** Foreground / background pairs the app really puts on screen. */
const TEXT_PAIRS: [keyof Palette, keyof Palette, number][] = [
  // Primary text must clear WCAG AA for body copy.
  ['ink', 'canvas', 4.5],
  ['ink', 'surface', 4.5],
  ['ink', 'surfaceAlt', 4.5],
  ['ink', 'sunken', 4.5],
  // Secondary text: AA for large text / UI, which is what it is used for.
  ['ink2', 'canvas', 3],
  ['ink2', 'surface', 3],
  // Placeholders and disabled states only need to be perceivable.
  ['muted', 'canvas', 2.5],
  ['faint', 'sunken', 1.6],
  // Text on the brand CTA. Light mode reaches ~3.2:1 with white; dark mode
  // inverts to dark-on-light and clears AA outright — so the bar is the same
  // either way and the palettes get there by opposite means.
  ['onEmber', 'ember', 3],
  ['onEspresso', 'espresso', 4.5],
  ['onEspressoMuted', 'espresso', 3],
  ['onEspressoDanger', 'espresso', 3],
];

describe.each([['light', light], ['dark', dark]] as const)('%s palette', (name, p) => {
  it.each(TEXT_PAIRS)('%s on %s is legible', (fg, bg, min) => {
    expect(contrast(p[fg], p[bg])).toBeGreaterThanOrEqual(min);
  });

  it('separates every surface from the canvas', () => {
    // If a card cannot be told apart from the page, the whole depth model — the
    // thing that says "this is a distinct object" — stops working.
    for (const key of ['surface', 'surfaceAlt', 'sunken'] as const) {
      expect(p[key]).not.toBe(p.canvas);
    }
  });

  it('keeps borders visible against the surface they divide', () => {
    expect(contrast(p.line, p.surface)).toBeGreaterThan(1.05);
    expect(contrast(p.lineStrong, p.surface)).toBeGreaterThan(contrast(p.line, p.surface));
  });

  it('is warm — never a neutral grey', () => {
    // The identity is a desert. A neutral or cool canvas would be a different
    // product that happens to share an icon.
    const h = p.canvas.replace('#', '');
    const [r, , b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    expect(r!).toBeGreaterThan(b!);
  });

  it(`${name}: elevation runs the right way`, () => {
    // Light: raised surfaces are LIGHTER than the canvas and read via shadow.
    // Dark: shadows are invisible, so raised surfaces separate by being lighter
    // still — the ordering is the same, but for the opposite reason.
    expect(luminance(p.surface)).toBeGreaterThan(luminance(p.canvasDeep));
  });
});

describe('palette parity', () => {
  it('defines exactly the same keys in both schemes', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it('gives every key a full 6-digit hex', () => {
    for (const p of [light, dark]) {
      for (const [key, value] of Object.entries(p)) {
        expect(value, key).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });

  it('actually differs — dark is not a copy', () => {
    const shared = Object.keys(light).filter(
      (k) => light[k as keyof Palette] === dark[k as keyof Palette],
    );
    // Only the universals are allowed to be identical.
    expect(shared.sort()).toEqual(
      ['black', 'onEspresso', 'onEspressoDanger', 'onEspressoMuted', 'white'].sort(),
    );
  });
});

describe('live token views', () => {
  it('follows the active scheme without call sites changing', () => {
    setScheme('light');
    const lightCanvas = colors.canvas;
    setScheme('dark');
    expect(colors.canvas).not.toBe(lightCanvas);
    expect(colors.canvas).toBe(dark.canvas);
    setScheme('light');
    expect(colors.canvas).toBe(lightCanvas);
  });

  it('carries derived tables along with it', () => {
    setScheme('light');
    const lightPending = statusTone.pending.bg;
    setScheme('dark');
    expect(statusTone.pending.bg).not.toBe(lightPending);
    setScheme('light');
  });

  it('schemed() tables built at module scope still follow', () => {
    // This is the trap the helper exists to close: a plain object literal here
    // would capture whichever scheme was active at import and never move again.
    const table = schemed(() => ({ bg: colors.canvas }));
    setScheme('dark');
    expect(table.bg).toBe(dark.canvas);
    setScheme('light');
    expect(table.bg).toBe(light.canvas);
  });

  it('restores the scheme it started under', () => {
    setScheme('light');
    schemed(() => ({ x: colors.ink }));
    expect(currentScheme()).toBe('light');
  });
});
