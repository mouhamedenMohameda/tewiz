/**
 * Safety-net for the rider restaurants filtering logic, pinned BEFORE the
 * ScrollView→FlatList migration so the visible-list contract can't silently
 * change during the perf refactor.
 *
 * Invariants locked here:
 *  - search is a case-insensitive substring over name/nameFr/nameAr/zone/tags
 *  - the cuisine chip ANDs with the search
 *  - chip counts reflect what a tap would show (search-restricted), and always
 *    expose an `all` total even for an empty catalog
 *  - a not-yet-loaded (null) catalog is treated as empty, never throws
 */
import { describe, expect, it } from 'vitest';
import type { Restaurant } from '../lib/restaurants';
import { cuisineCounts, filterRestaurants, matchesSearch } from '../lib/restaurantFilter';

/** Restaurant factory — only the fields the filter reads need to be realistic. */
function mk(partial: Partial<Restaurant> & { id: string; name: string }): Restaurant {
  return {
    nameFr: null,
    nameAr: null,
    nameEn: null,
    zone: null,
    cuisine: null,
    tags: [],
    priceLevel: null,
    rating: null,
    etaMin: null,
    etaMax: null,
    description: null,
    photo: null,
    photos: [],
    phone: null,
    phones: [],
    address: null,
    lat: 18.08,
    lng: -15.97,
    popularity: 0,
    osmValue: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

const CATALOG: Restaurant[] = [
  mk({ id: '1', name: 'Chez Ali', cuisine: 'pizza', zone: 'Tevragh Zeina', tags: ['four à bois'] }),
  mk({ id: '2', name: 'Le Petit Dakar', cuisine: 'mauritanien', nameAr: 'مطعم', tags: ['thieboudienne'] }),
  mk({ id: '3', name: 'Burger House', cuisine: 'burger', tags: ['fast'] }),
  mk({ id: '4', name: 'Pizza Roma', cuisine: 'pizza', tags: [] }),
];

describe('matchesSearch', () => {
  it('matches everything on an empty or whitespace query', () => {
    expect(matchesSearch(CATALOG[0]!, '')).toBe(true);
    expect(matchesSearch(CATALOG[0]!, '   ')).toBe(true);
  });

  it('is case-insensitive on the name', () => {
    expect(matchesSearch(CATALOG[0]!, 'chez ALI')).toBe(true);
    expect(matchesSearch(CATALOG[0]!, 'zebra')).toBe(false);
  });

  it('searches across zone, tags and the Arabic name too', () => {
    expect(matchesSearch(CATALOG[0]!, 'tevragh')).toBe(true); // zone
    expect(matchesSearch(CATALOG[0]!, 'four à bois')).toBe(true); // tag
    expect(matchesSearch(CATALOG[1]!, 'مطعم')).toBe(true); // nameAr
  });
});

describe('filterRestaurants', () => {
  it('returns [] for a null (unloaded) catalog', () => {
    expect(filterRestaurants(null, 'all', '')).toEqual([]);
  });

  it('returns the full catalog for the "all" chip and empty query', () => {
    expect(filterRestaurants(CATALOG, 'all', '')).toHaveLength(4);
  });

  it('narrows to a single cuisine', () => {
    const pizzas = filterRestaurants(CATALOG, 'pizza', '');
    expect(pizzas.map((r) => r.id)).toEqual(['1', '4']);
  });

  it('ANDs the cuisine chip with the search query', () => {
    const res = filterRestaurants(CATALOG, 'pizza', 'roma');
    expect(res.map((r) => r.id)).toEqual(['4']);
  });
});

describe('cuisineCounts', () => {
  it('always exposes an "all" key, even for an empty/null catalog', () => {
    expect(cuisineCounts(null, '')).toEqual({ all: 0 });
    expect(cuisineCounts([], 'anything')).toEqual({ all: 0 });
  });

  it('counts per-cuisine plus the all-total on the full catalog', () => {
    expect(cuisineCounts(CATALOG, '')).toEqual({
      all: 4,
      pizza: 2,
      mauritanien: 1,
      burger: 1,
    });
  });

  it('restricts counts to entries matching the current search', () => {
    // "pizza" text appears in "Pizza Roma" (id 4) only; id 1 is "Chez Ali".
    expect(cuisineCounts(CATALOG, 'roma')).toEqual({ all: 1, pizza: 1 });
  });
});
