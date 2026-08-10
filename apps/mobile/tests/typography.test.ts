/**
 * The type ramp encodes design decisions that are easy to break by accident
 * with a one-line "just bump this". These lock in the rules themselves rather
 * than the numbers, so the ramp can be retuned without rewriting the tests.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_FONT_SCALE, maxFontScale, type } from '@/theme';

const RAMP = [
  'hero', 'display', 'h1', 'h2', 'title', 'body', 'label', 'caption', 'overline',
] as const;

describe('type ramp', () => {
  it('descends in size from hero to overline', () => {
    const sizes = RAMP.map((k) => type[k].fontSize);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]!).toBeLessThan(sizes[i - 1]!);
    }
  });

  it('tightens leading as text grows — big text needs proportionally less', () => {
    const ratio = (k: (typeof RAMP)[number]) => type[k].lineHeight / type[k].fontSize;
    expect(ratio('hero')).toBeLessThan(ratio('body'));
    expect(ratio('h1')).toBeLessThan(ratio('body'));
  });

  it('tracks display sizes negative and small sizes positive', () => {
    // Letters read too far apart as they grow, and too crowded as they shrink.
    // A single letter-spacing for the whole ramp is wrong at one end or other.
    expect(type.hero.letterSpacing).toBeLessThan(0);
    expect(type.display.letterSpacing).toBeLessThan(0);
    expect(type.caption.letterSpacing).toBeGreaterThan(0);
  });

  it('crosses zero exactly once, going down the ramp', () => {
    const tracking = RAMP
      .filter((k) => k !== 'overline') // all-caps eyebrow, tracked on purpose
      .map((k) => type[k].letterSpacing ?? 0);
    const crossings = tracking
      .slice(1)
      .filter((v, i) => {
        const prev = tracking[i]!;
        return v !== 0 && prev !== 0 && Math.sign(v) !== Math.sign(prev);
      });
    expect(crossings.length).toBeLessThanOrEqual(1);
  });
});

describe('Dynamic Type ceilings', () => {
  it('covers every ramp step', () => {
    for (const key of Object.keys(type)) {
      expect(maxFontScale[key as keyof typeof type]).toBeGreaterThan(1);
    }
  });

  it('gives SMALL text the most headroom and display text the least', () => {
    // This is the rule that keeps the hierarchy alive at maximum size: if every
    // step shared one ceiling, a caption and a title would converge and the
    // ramp would stop meaning anything to the people who most need it to.
    expect(maxFontScale.caption).toBeGreaterThan(maxFontScale.body);
    expect(maxFontScale.body).toBeGreaterThan(maxFontScale.h2);
    expect(maxFontScale.h2).toBeGreaterThan(maxFontScale.hero);
  });

  it('never lets a ceiling shrink text', () => {
    for (const value of Object.values(maxFontScale)) expect(value).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_MAX_FONT_SCALE).toBeGreaterThanOrEqual(1);
  });

  it('keeps hierarchy intact even at each step-s own maximum', () => {
    // A body line at its ceiling must still not outgrow an h1 at its ceiling,
    // or the page inverts for exactly the users who enlarged the text.
    const scaled = (k: keyof typeof type) => type[k].fontSize * maxFontScale[k];
    expect(scaled('body')).toBeLessThan(scaled('h1'));
    expect(scaled('caption')).toBeLessThan(scaled('title'));
  });
});
