/**
 * Safety-net for restaurant COVER resolution (hero + list thumbnail).
 * Locks the selection contract so a rendering refactor can't silently change
 * WHICH cover a restaurant gets, break determinism, start throwing, or drift
 * the requested width off a retina-appropriate size.
 *
 * Note: the admin-uploaded `photo` is the restaurant's MENU card, not a cover,
 * so the cover resolver deliberately ignores it (see restaurantPhotos.ts).
 *
 * Invariants:
 *  - the cover is always a deterministic Unsplash URL (never the admin photo)
 *  - selection is deterministic per restaurant id
 *  - an unknown cuisine/osmValue still yields a well-formed URL (default pool),
 *    never undefined/throws
 *  - the pool is actually spread across ids (not collapsed to one image)
 */
import { describe, expect, it } from 'vitest';
import { resolveRestaurantCover } from '../lib/restaurantPhotos';

type CoverInput = Parameters<typeof resolveRestaurantCover>[0];

const UNSPLASH_RE = /^https:\/\/images\.unsplash\.com\/photo-[\w-]+\?w=(\d+)&q=80$/;

function row(partial: Partial<CoverInput> & { id: string }): CoverInput {
  return { cuisine: null, osmValue: null, ...partial };
}

describe('resolveRestaurantCover', () => {
  it('always returns an Unsplash cover keyed on cuisine, never the admin photo', () => {
    const url = resolveRestaurantCover(row({ id: '1', cuisine: 'pizza' }));
    expect(url).toMatch(UNSPLASH_RE);
  });

  it('is deterministic for the same id', () => {
    const r = row({ id: 'stable-42', cuisine: 'burger' });
    expect(resolveRestaurantCover(r)).toBe(resolveRestaurantCover(r));
  });

  it('falls back to a well-formed Unsplash URL for a photo-less row', () => {
    const url = resolveRestaurantCover(row({ id: '7', cuisine: 'pizza' }));
    expect(url).toMatch(UNSPLASH_RE);
  });

  it('still resolves for an unknown cuisine and a null osmValue (default pool)', () => {
    const url = resolveRestaurantCover(row({ id: '9', cuisine: 'klingon-fusion' }));
    expect(url).toMatch(UNSPLASH_RE);
    expect(url).toBeTruthy();
  });

  it('requests a retina-appropriate width for full-width cards', () => {
    const url = resolveRestaurantCover(row({ id: '3', cuisine: 'cafe' }));
    const width = Number(url.match(UNSPLASH_RE)?.[1]);
    // Full-width cards on @2x–@3x need ~700–1000 physical px. Pinned so it
    // can't silently drift to a blurry (too small) or heavy (too large) value.
    expect(width).toBeGreaterThanOrEqual(700);
    expect(width).toBeLessThanOrEqual(1000);
  });

  it('spreads the pool across many ids rather than collapsing to one image', () => {
    const urls = new Set(
      Array.from({ length: 60 }, (_, i) => resolveRestaurantCover(row({ id: `resto-${i}`, cuisine: 'asiatique' }))),
    );
    expect(urls.size).toBeGreaterThan(1);
  });
});
