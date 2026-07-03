/**
 * Pure filtering / counting logic for the rider restaurants screen.
 *
 * Extracted out of `app/(app)/rider/restaurants.tsx` so it can be unit-tested
 * in the node environment (the screen itself pulls in react-native) and reused
 * verbatim when the list is migrated from ScrollView+map to a FlatList. The
 * behaviour here is a 1:1 lift of the previous inline `matchesSearch`,
 * `counts` and `filtered` — search is a case-insensitive substring match over
 * name/nameFr/nameAr/zone/tags, filtering ANDs the active cuisine chip with the
 * search, and counts reflect what would show *after* a chip tap.
 */

import type { Restaurant } from './restaurants';

/**
 * Case-insensitive substring match over the fields a user would search by.
 * An empty / whitespace-only query matches everything.
 */
export function matchesSearch(r: Restaurant, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${r.name} ${r.nameFr ?? ''} ${r.nameAr ?? ''} ${r.zone ?? ''} ${r.tags.join(' ')}`.toLowerCase();
  return hay.includes(q);
}

/**
 * Per-cuisine counts (plus an `all` total) restricted to entries matching the
 * current search — so the chip badges reflect what a tap would actually show.
 */
export function cuisineCounts(
  items: Restaurant[] | null | undefined,
  query: string,
): Record<string, number> {
  const m: Record<string, number> = { all: 0 };
  for (const r of items ?? []) {
    if (!matchesSearch(r, query)) continue;
    m.all = (m.all ?? 0) + 1;
    if (r.cuisine) m[r.cuisine] = (m[r.cuisine] ?? 0) + 1;
  }
  return m;
}

/**
 * The visible list: the active cuisine chip ANDed with the search query.
 * `cuisine === 'all'` clears the cuisine constraint. A null `items` (not yet
 * loaded) yields an empty array.
 */
export function filterRestaurants(
  items: Restaurant[] | null | undefined,
  cuisine: string,
  query: string,
): Restaurant[] {
  if (!items) return [];
  return items.filter((r) => {
    if (cuisine !== 'all' && r.cuisine !== cuisine) return false;
    return matchesSearch(r, query);
  });
}
