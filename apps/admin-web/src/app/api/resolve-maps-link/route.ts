/**
 * GET /api/resolve-maps-link?url=<google-maps-short-link>
 *
 * Google short links (maps.app.goo.gl / goo.gl / g.co) carry no coordinates
 * in the pasted string — they only redirect to the full maps URL, which does
 * (`?q=lat,lng` or `/@lat,lng`). The browser can't follow that redirect
 * (cross-origin, opaque), so the restaurant importer calls this route and we
 * follow it server-side, returning the parsed { lat, lng, name }.
 *
 * SSRF guard: every hop — including each redirect target — must be one of
 * Google's own map/short-link hosts, so this endpoint can't be pointed at an
 * arbitrary or internal address.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { parseGoogleMapsUrl } from '@/lib/google-maps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_HOSTS = new Set([
  'maps.app.goo.gl',
  'goo.gl',
  'g.co',
  'maps.google.com',
  'www.google.com',
  'google.com',
]);

function hostAllowed(u: string): boolean {
  try {
    return ALLOWED_HOSTS.has(new URL(u).hostname.toLowerCase());
  } catch {
    return false;
  }
}

// A plain, non-Chrome User-Agent: desktop-browser UAs get served a JS
// "open in the app" interstitial (HTTP 200, no Location), while a neutral
// agent gets the plain 302 chain we can actually follow.
const UA = 'TewizAdmin/1.0 (+https://radar-mr.com)';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')?.trim();
  if (!url) {
    return NextResponse.json({ error: 'Paramètre « url » manquant.' }, { status: 400 });
  }
  if (!hostAllowed(url)) {
    return NextResponse.json({ error: 'Hôte non autorisé.' }, { status: 400 });
  }

  // Already a full URL with coordinates? No need to hit the network.
  const direct = parseGoogleMapsUrl(url);
  if (direct) return NextResponse.json(direct);

  let current = url;
  for (let hop = 0; hop < 8; hop++) {
    if (!hostAllowed(current)) break;

    let res: Response;
    try {
      res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      return NextResponse.json(
        { error: 'Impossible de contacter Google Maps.' },
        { status: 502 },
      );
    }

    // Coordinates live in the redirect targets — read them straight from the
    // Location header rather than loading the final page.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) break;
      const next = new URL(loc, current).toString();
      const parsed = parseGoogleMapsUrl(next);
      if (parsed) return NextResponse.json(parsed);
      current = next;
      continue;
    }
    break; // reached a non-redirect response — nothing more to follow
  }

  return NextResponse.json(
    { error: 'Lien Google Maps non résolu — aucune coordonnée trouvée.' },
    { status: 422 },
  );
}
