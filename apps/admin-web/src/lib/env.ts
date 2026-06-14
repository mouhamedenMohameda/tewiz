// Public env — exposed to the browser.
// Override in .env.local for production.
export const API_URL =
  (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_API_URL)
  || process.env.NEXT_PUBLIC_API_URL
  || 'https://tewiz-api.radar-mr.com';

// Browser Google Maps JS key (Maps JavaScript API). Distinct from the
// server-side GOOGLE_PLACES_API_KEY used by the API. When empty, the
// voice-requests map degrades gracefully to manual lat/lng + POI search.
export const GOOGLE_MAPS_API_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
