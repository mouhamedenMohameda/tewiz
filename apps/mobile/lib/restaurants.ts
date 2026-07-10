/**
 * Rider restaurants directory — data layer.
 *
 * The list used to live as a bundled JSON in this file. It now comes from
 * GET /rider/restaurants and is curated from the admin back office. Only
 * `id`, `name`, `lat` and `lng` are guaranteed; every other field is
 * optional so OSM-seeded rows (which arrive with bare names) coexist with
 * fully-curated entries that have photo + tags + description.
 */

import { api } from './api';

export type PriceLevel = '$' | '$$' | '$$$';

export type Cuisine =
  | 'mauritanien' | 'pizza' | 'burger' | 'libanais'
  | 'asiatique' | 'cafe' | 'patisserie' | 'grillades'
  | string;

export interface Restaurant {
  id: string;
  name: string;
  nameFr: string | null;
  nameAr: string | null;
  nameEn: string | null;
  zone: string | null;
  cuisine: Cuisine | null;
  tags: string[];
  priceLevel: PriceLevel | null;
  rating: number | null;
  etaMin: number | null;
  etaMax: number | null;
  description: string | null;
  photo: string | null;
  photos: string[];
  phone: string | null;
  phones: string[];
  address: string | null;
  lat: number;
  lng: number;
  popularity: number;
  osmValue: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  items: Restaurant[];
  total: number;
  limit: number;
  offset: number;
}

export async function fetchRestaurants(opts: { search?: string; cuisine?: string } = {}): Promise<Restaurant[]> {
  const params = new URLSearchParams();
  if (opts.search?.trim()) params.set('search', opts.search.trim());
  if (opts.cuisine && opts.cuisine !== 'all') params.set('cuisine', opts.cuisine);
  const qs = params.toString();
  const r = await api.get<ListResponse>(`/rider/restaurants${qs ? `?${qs}` : ''}`);
  return r.data.items;
}

export async function fetchRestaurantById(id: string): Promise<Restaurant> {
  const r = await api.get<Restaurant>(`/rider/restaurants/${encodeURIComponent(id)}`);
  return r.data;
}

/**
 * UI category chips. The `all` chip clears the filter; the others map 1:1
 * to the DB `cuisine` column. New cuisines auto-appear once the admin
 * starts tagging restaurants with them — this list only defines the
 * curated quick-filters.
 */
export const CUISINE_CATEGORIES: Array<{ key: 'all' | string; label: string; icon: string }> = [
  { key: 'all',         label: 'Tout',        icon: '✨' },
  { key: 'mauritanien', label: 'Mauritanien', icon: '🇲🇷' },
  { key: 'pizza',       label: 'Pizza',       icon: '🍕' },
  { key: 'burger',      label: 'Burger',      icon: '🍔' },
  { key: 'libanais',    label: 'Libanais',    icon: '🥙' },
  { key: 'asiatique',   label: 'Asiatique',   icon: '🥡' },
  { key: 'grillades',   label: 'Grillades',   icon: '🍖' },
  { key: 'cafe',        label: 'Café',        icon: '☕' },
  { key: 'patisserie',  label: 'Pâtisserie',  icon: '🥐' },
];
