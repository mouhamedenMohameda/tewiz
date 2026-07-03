/**
 * Safety-net for restaurant photo resolution, pinned BEFORE the FlatList +
 * expo-image migration. Locks the selection contract so the rendering refactor
 * can't silently change WHICH photo a restaurant gets, break determinism,
 * start throwing, or drift the requested width off a retina-appropriate size.
 *
 * Invariants:
 *  - an admin-set `photo` always wins verbatim (never rewritten to Unsplash)
 *  - selection is deterministic per restaurant id
 *  - a photo-less row still yields a well-formed Unsplash URL, even for an
 *    unknown cuisine/osmValue (default pool), and never undefined/throws
 *  - the pool is actually spread across ids (not collapsed to one image)
 */
import { describe, expect, it } from 'vitest';
import { resolveRestaurantPhoto } from '../lib/restaurantPhotos';

type PhotoInput = Parameters<typeof resolveRestaurantPhoto>[0];

const UNSPLASH_RE = /^https:\/\/images\.unsplash\.com\/photo-[\w-]+\?w=(\d+)&q=80$/;

function row(partial: Partial<PhotoInput> & { id: string }): PhotoInput {
  return { photo: null, cuisine: null, osmValue: null, ...partial };
}

describe('resolveRestaurantPhoto', () => {
  it('returns the admin-set photo verbatim, ignoring cuisine/osmValue', () => {
    const url = 'https://cdn.tewiz.mr/restos/ali.jpg';
    expect(resolveRestaurantPhoto(row({ id: '1', photo: url, cuisine: 'pizza' }))).toBe(url);
  });

  it('is deterministic for the same id', () => {
    const r = row({ id: 'stable-42', cuisine: 'burger' });
    expect(resolveRestaurantPhoto(r)).toBe(resolveRestaurantPhoto(r));
  });

  it('falls back to a well-formed Unsplash URL for a photo-less row', () => {
    const url = resolveRestaurantPhoto(row({ id: '7', cuisine: 'pizza' }));
    expect(url).toMatch(UNSPLASH_RE);
  });

  it('still resolves for an unknown cuisine and a null osmValue (default pool)', () => {
    const url = resolveRestaurantPhoto(row({ id: '9', cuisine: 'klingon-fusion' }));
    expect(url).toMatch(UNSPLASH_RE);
    expect(url).toBeTruthy();
  });

  it('requests a retina-appropriate width for full-width cards', () => {
    const url = resolveRestaurantPhoto(row({ id: '3', cuisine: 'cafe' }));
    const width = Number(url.match(UNSPLASH_RE)?.[1]);
    // Full-width cards on @2x–@3x need ~700–1000 physical px. Pinned so it
    // can't silently drift to a blurry (too small) or heavy (too large) value.
    expect(width).toBeGreaterThanOrEqual(700);
    expect(width).toBeLessThanOrEqual(1000);
  });

  it('spreads the pool across many ids rather than collapsing to one image', () => {
    const urls = new Set(
      Array.from({ length: 60 }, (_, i) => resolveRestaurantPhoto(row({ id: `resto-${i}`, cuisine: 'asiatique' }))),
    );
    expect(urls.size).toBeGreaterThan(1);
  });
});
