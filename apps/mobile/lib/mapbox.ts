import Constants from 'expo-constants';

type MapboxModule = typeof import('@rnmapbox/maps');

let mapboxModule: MapboxModule | null | undefined;

function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

export function getMapbox(): MapboxModule | null {
  if (mapboxModule !== undefined) return mapboxModule;
  if (isExpoGo()) {
    mapboxModule = null;
    return mapboxModule;
  }
  try {
    const loaded = require('@rnmapbox/maps');
    mapboxModule = (loaded.default ?? loaded) as MapboxModule;
  } catch {
    // Missing native module or not linked in the current runtime.
    mapboxModule = null;
  }
  return mapboxModule;
}

// Public Mapbox token (pk.*). Restrict to the app's iOS/Android bundle IDs in
// the Mapbox dashboard. When missing the MapShell renders a graceful fallback.
export const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

export const MAPBOX_STYLE_URL = 'mapbox://styles/mapbox/streets-v12';

let initialized = false;

/**
 * Initialise the Mapbox SDK with the public access token. Safe to call
 * multiple times — only the first invocation hits the native bridge.
 * Returns false when no token is set so callers can render a fallback.
 */
export function initMapbox(): boolean {
  const M = getMapbox();
  if (!MAPBOX_TOKEN || !M) return false;
  if (initialized) return true;
  M.setAccessToken(MAPBOX_TOKEN);
  // Telemetry is opt-out by default on iOS, opt-in on Android. Disable
  // both for predictability — we don't need Mapbox analytics.
  M.setTelemetryEnabled(false);
  initialized = true;
  return true;
}

/** Nouakchott Tevragh Zeina — default centre for every map. */
export const NKC_CENTER: [number, number] = [-15.9785, 18.0858];
export const DEFAULT_ZOOM = 12;
