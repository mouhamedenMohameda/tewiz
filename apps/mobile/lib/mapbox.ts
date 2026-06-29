import Mapbox from '@rnmapbox/maps';

// Public Mapbox token (pk.*). Restrict to the app's iOS/Android bundle IDs in
// the Mapbox dashboard. When missing the MapShell renders a graceful fallback.
export const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

export const MAPBOX_STYLE_URL = Mapbox.StyleURL.Street;

let initialized = false;

/**
 * Initialise the Mapbox SDK with the public access token. Safe to call
 * multiple times — only the first invocation hits the native bridge.
 * Returns false when no token is set so callers can render a fallback.
 */
export function initMapbox(): boolean {
  if (!MAPBOX_TOKEN) return false;
  if (initialized) return true;
  Mapbox.setAccessToken(MAPBOX_TOKEN);
  // Telemetry is opt-out by default on iOS, opt-in on Android. Disable
  // both for predictability — we don't need Mapbox analytics.
  Mapbox.setTelemetryEnabled(false);
  initialized = true;
  return true;
}

/** Nouakchott Tevragh Zeina — default centre for every map. */
export const NKC_CENTER: [number, number] = [-15.9785, 18.0858];
export const DEFAULT_ZOOM = 12;

export { Mapbox };
