/**
 * Parsing + resolution helpers for the Google Maps links pasted into the
 * restaurant importer.
 *
 * A "full" maps URL already carries its coordinates in the string
 * (`…/@lat,lng…` or `…?q=lat,lng…`) and is parsed synchronously in the
 * browser. A "short" link (maps.app.goo.gl / goo.gl / g.co) carries none —
 * it only redirects to the full URL — so it must be resolved server-side by
 * following its redirects. See app/api/resolve-maps-link/route.ts.
 */

export type ParsedMapsLocation = { lat: string; lng: string; name?: string };

// Format: https://maps.google.com/?q=18.0862,-15.9753
// Format: https://www.google.com/maps/place/Restaurant+Name/@18.0862,-15.9753,17z
// Format: https://www.google.com/maps/@18.0862,-15.9753,17z
// Short links (maps.app.goo.gl/…) carry no coordinates — resolve them first.
const coordsRegex = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
const qRegex = /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/;
const placeRegex = /\/place\/([^/@]+)\//;

/** Extract lat, lng and optional name from a full Google Maps URL. */
export function parseGoogleMapsUrl(url: string): ParsedMapsLocation | null {
  try {
    let lat: string | undefined;
    let lng: string | undefined;
    let name: string | undefined;

    const cm = url.match(coordsRegex);
    if (cm) { lat = cm[1]; lng = cm[2]; }

    if (!lat) {
      const qm = url.match(qRegex);
      if (qm) { lat = qm[1]; lng = qm[2]; }
    }

    if (!lat || !lng) return null;

    const pm = url.match(placeRegex);
    if (pm) {
      name = decodeURIComponent(pm[1]!.replace(/\+/g, ' '));
    }

    return { lat, lng, name };
  } catch {
    return null;
  }
}

// Short-link hosts that redirect to a full maps URL. Because these carry no
// coordinates in the pasted string, the browser can't read them directly
// (the redirect target is on google.com and blocked by CORS) — resolution
// happens through the server route.
const SHORT_LINK_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'g.co']);

/** True when the URL is a Google short link that needs server-side resolution. */
export function isGoogleMapsShortLink(url: string): boolean {
  try {
    return SHORT_LINK_HOSTS.has(new URL(url.trim()).hostname.toLowerCase());
  } catch {
    return false;
  }
}
