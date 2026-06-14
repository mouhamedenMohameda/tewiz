/**
 * Shared place-search service. Wraps Google Places (New) Text Search when
 * GOOGLE_PLACES_API_KEY is set, otherwise falls back to Nominatim. Results
 * are biased to Mauritania.
 *
 * Consumers:
 *   - geocode.routes.ts        → GET /geocode/search (rider + admin)
 *   - voice-rides/poi.service  → admin POI search (local corpus + this)
 */

import { env } from '../../config/env.js';
import { HttpError } from '../../middleware/error.js';

export interface GeocodeResult {
  id: string;
  label: string;
  name: string;
  lat: number;
  lng: number;
  types: string[];
}

export interface SearchPlacesInput {
  q: string;
  /** Bias results toward a point, "lng,lat". */
  proximity?: string;
  limit?: number;
}

/** True when an external geocoder is configured (Google or the free Nominatim). */
export const GEOCODER_AVAILABLE = true; // Nominatim is always available as a fallback.

export async function searchPlaces(input: SearchPlacesInput): Promise<GeocodeResult[]> {
  const limit = Math.min(Math.max(input.limit ?? 6, 1), 10);
  return env.GOOGLE_PLACES_API_KEY
    ? searchWithGooglePlaces(input.q, input.proximity, limit)
    : searchWithNominatim(input.q, input.proximity, limit);
}

// ---------------------------------------------------------------------------
// Google Places (New) — Text Search
// Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
// ---------------------------------------------------------------------------

interface GooglePlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  types?: string[];
}

async function searchWithGooglePlaces(
  q: string,
  proximity: string | undefined,
  limit: number,
): Promise<GeocodeResult[]> {
  const body: Record<string, unknown> = {
    textQuery: q,
    languageCode: 'fr',
    regionCode: 'MR',
    maxResultCount: limit,
  };
  // Bias results toward the given area (~50 km radius).
  if (proximity) {
    const [lng, lat] = proximity.split(',').map(Number) as [number, number];
    body.locationBias = {
      circle: { center: { latitude: lat, longitude: lng }, radius: 50_000 },
    };
  }

  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY!,
      // Field mask drives billing — request only what we need.
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.types',
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new HttpError(
      502,
      'geocoder_failed',
      `Google Places returned ${r.status}: ${text.slice(0, 200)}`,
    );
  }

  const data = (await r.json()) as { places?: GooglePlace[] };
  return (data.places ?? []).map((p) => {
    const name = p.displayName?.text ?? p.formattedAddress ?? 'Lieu';
    return {
      id: p.id,
      label: p.formattedAddress ?? name,
      name,
      lat: p.location?.latitude ?? 0,
      lng: p.location?.longitude ?? 0,
      types: p.types ?? [],
    };
  });
}

// ---------------------------------------------------------------------------
// Nominatim fallback (used only when GOOGLE_PLACES_API_KEY is unset)
// ---------------------------------------------------------------------------

interface NominatimRow {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  type?: string;
  class?: string;
}

// Nominatim usage policy requires a real, contactable User-Agent.
// See https://operations.osmfoundation.org/policies/nominatim/
const NOMINATIM_UA = 'Tewiz/1.0 (https://github.com/tewiz; contact@tewiz.mr)';

async function searchWithNominatim(
  q: string,
  proximity: string | undefined,
  limit: number,
): Promise<GeocodeResult[]> {
  const params = new URLSearchParams({
    q,
    format: 'json',
    countrycodes: 'mr',
    'accept-language': 'fr',
    limit: String(limit),
    addressdetails: '0',
  });
  if (proximity) {
    const [lng, lat] = proximity.split(',').map(Number) as [number, number];
    const delta = 0.5;
    params.set('viewbox', `${lng - delta},${lat + delta},${lng + delta},${lat - delta}`);
    params.set('bounded', '0');
  }

  const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': NOMINATIM_UA, Accept: 'application/json' },
  });
  if (!r.ok) {
    throw new HttpError(502, 'geocoder_failed', `Nominatim returned ${r.status}`);
  }
  const rows = (await r.json()) as NominatimRow[];
  return rows.map((f) => {
    const name = f.name || f.display_name.split(',')[0]!.trim();
    return {
      id: String(f.place_id),
      label: f.display_name,
      name,
      lat: Number(f.lat),
      lng: Number(f.lon),
      types: f.class && f.type ? [f.class, f.type] : [],
    };
  });
}
