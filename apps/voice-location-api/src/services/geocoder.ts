import { env } from '../config.js';
import { resolveLocal, type PoiRow } from './pois.js';
import { autoSeedFromGoogle } from './auto-seed.js';
import { withRetry, withTimeout } from '../lib/retry.js';

const GOOGLE_GEOCODE_TIMEOUT_MS = 8_000;

export interface GeocodeResult {
  lat: number;
  lng: number;
  formatted_address: string;
  place_id: string;
  /** Google's location_type: ROOFTOP > RANGE_INTERPOLATED > GEOMETRIC_CENTER > APPROXIMATE */
  location_type: string;
  /** Top-level types from Google (e.g. ["mosque","point_of_interest"]). */
  types: string[];
  /** "high" | "medium" | "low" derived from location_type. */
  precision: 'high' | 'medium' | 'low';
  /** Distance in meters of the result's viewport diagonal — bigger = vaguer. */
  viewport_diagonal_m: number | null;
}

interface GoogleGeocodeResponse {
  status: string;
  error_message?: string;
  results: Array<{
    formatted_address: string;
    place_id: string;
    types: string[];
    geometry: {
      location: { lat: number; lng: number };
      location_type: string;
      viewport?: {
        northeast: { lat: number; lng: number };
        southwest: { lat: number; lng: number };
      };
    };
  }>;
}

function precisionFromLocationType(t: string): 'high' | 'medium' | 'low' {
  if (t === 'ROOFTOP') return 'high';
  if (t === 'RANGE_INTERPOLATED' || t === 'GEOMETRIC_CENTER') return 'medium';
  return 'low';
}

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * Convert a local POI row into the same GeocodeResult shape Google returns,
 * so downstream code doesn't care whether the result came from the corpus
 * or from Google. OSM POIs are treated as "high" precision because they
 * are concrete, named locations with explicit coordinates.
 */
function localPoiToGeocodeResult(p: PoiRow): GeocodeResult {
  const namePart =
    p.name_fr ?? p.name_default ?? p.name_en ?? p.name_ar ?? 'POI';
  return {
    lat: p.lat,
    lng: p.lng,
    formatted_address: `${namePart}, Nouakchott, Mauritanie`,
    place_id: p.google_place_id ?? `osm:${p.id}`,
    location_type: 'ROOFTOP',
    types: [p.osm_kind, p.osm_value].filter((x): x is string => !!x),
    precision: 'high',
    viewport_diagonal_m: null,
  };
}

export async function geocode(query: string): Promise<GeocodeResult | null> {
  // 1. Local-first: try the Nouakchott POI corpus. If we get a high-confidence
  //    trigram match we skip Google entirely — faster, free, and more accurate
  //    for known places (especially Hassaniya names that Google may miss).
  try {
    const local = await resolveLocal(query);
    if (local) return localPoiToGeocodeResult(local);
  } catch {
    // Soft-fail: if the POI lookup errors out we still try Google below.
  }

  // 2. Fallback: Google Geocoding.
  const params = new URLSearchParams({
    address: query,
    key: env.GOOGLE_MAPS_API_KEY,
    region: env.GEOCODE_REGION,
    language: env.GEOCODE_LANGUAGE,
  });
  if (env.GEOCODE_BOUNDS) params.set('bounds', env.GEOCODE_BOUNDS);

  const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;

  // Retry on transient network errors / 5xx; abort hung sockets at 8 s so
  // a slow Google response never blocks the user for more than a few
  // seconds (the SDKs above already have their own timeouts).
  const data = await withRetry(
    async () => {
      const controller = new AbortController();
      const res = await withTimeout(
        fetch(url, { signal: controller.signal }),
        GOOGLE_GEOCODE_TIMEOUT_MS,
        () => controller.abort(),
      );
      if (!res.ok) {
        // Surface status on the error so the retry policy can decide.
        const e: Error & { status?: number } = new Error(`Google Geocoding HTTP ${res.status}`);
        e.status = res.status;
        throw e;
      }
      return (await res.json()) as GoogleGeocodeResponse;
    },
    { retries: 2, baseDelayMs: 250 },
  );

  if (data.status === 'ZERO_RESULTS') return null;
  if (data.status !== 'OK') {
    throw new Error(`Google Geocoding status=${data.status}: ${data.error_message ?? ''}`);
  }

  const r = data.results[0];
  if (!r) return null;
  const viewportDiag = r.geometry.viewport
    ? haversineMeters(r.geometry.viewport.southwest, r.geometry.viewport.northeast)
    : null;

  const result: GeocodeResult = {
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    formatted_address: r.formatted_address,
    place_id: r.place_id,
    location_type: r.geometry.location_type,
    types: r.types,
    precision: precisionFromLocationType(r.geometry.location_type),
    viewport_diagonal_m: viewportDiag,
  };

  // Auto-seed: if the Google result is precise and specific enough, persist
  // it into the local corpus so the next user saying the same thing is
  // served locally without a billed Google call. Soft-failure — if the
  // seed insert errors out, the geocode response is still returned.
  autoSeedFromGoogle(query, result).catch(() => undefined);

  return result;
}
