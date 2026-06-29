// Public env — exposed to the browser.
// Override in .env.local for production.
export const API_URL =
  (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_API_URL)
  || process.env.NEXT_PUBLIC_API_URL
  || 'https://tewiz-api.radar-mr.com';

// Browser Mapbox public token (pk.*). Restrict to the admin-web domain in
// the Mapbox dashboard. When empty, map components render a graceful
// fallback panel and the rest of the admin keeps working.
export const MAPBOX_TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

// Default style used across every admin map. Swap for a branded style URL
// once one is published from Mapbox Studio.
export const MAPBOX_STYLE = 'mapbox://styles/mapbox/streets-v12';
