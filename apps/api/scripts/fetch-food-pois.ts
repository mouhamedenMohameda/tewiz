/**
 * Pull EVERY food-related POI in Greater Nouakchott from OpenStreetMap and
 * write a JSON the admin bulk-import endpoint can swallow as-is.
 *
 *   pnpm --filter @tewiz/api fetch:food-pois
 *
 * Output: apps/api/seeds/restaurants-nouakchott-full.json
 *
 * Wider than the original ingester used by voice-location-api:
 *   - amenity = restaurant | cafe | fast_food | bar | pub | food_court
 *               | ice_cream | biergarten
 *   - any feature carrying a cuisine=* tag (catches places with no amenity
 *     but a clear cuisine hint)
 *   - shop=bakery | confectionery | pastry (boulangeries / patisseries)
 *
 * Idempotent: re-running just refreshes the JSON; the admin bulk-import
 * then upserts on slug so existing restaurants are merged, not duplicated.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// [south, west, north, east] — slightly padded around Greater Nouakchott.
const BBOX: [number, number, number, number] = [17.90, -16.15, 18.25, -15.78];

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

const AMENITIES = [
  'restaurant', 'cafe', 'fast_food', 'bar', 'pub',
  'food_court', 'ice_cream', 'biergarten',
] as const;

const SHOPS = ['bakery', 'confectionery', 'pastry'] as const;

const OVERPASS_QUERY = `
[out:json][timeout:180];
(
  ${AMENITIES.map((a) => `
    node[name][amenity=${a}](${BBOX.join(',')});
    way[name][amenity=${a}](${BBOX.join(',')});
  `).join('')}

  ${SHOPS.map((s) => `
    node[name][shop=${s}](${BBOX.join(',')});
    way[name][shop=${s}](${BBOX.join(',')});
  `).join('')}

  // Anything carrying a cuisine= tag even without an explicit amenity
  // (rare but catches e.g. delis tagged shop=convenience+cuisine=mauritanian).
  node[name][cuisine](${BBOX.join(',')});
  way[name][cuisine](${BBOX.join(',')});
);
out center tags;
`;

// ---------------------------------------------------------------------------

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

async function fetchOverpass(query: string): Promise<OverpassResponse> {
  let lastErr: unknown = null;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      process.stdout.write(`[overpass] ${url} ... `);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'tewiz-api/0.1 fetch-food-pois (contact: mohameda@tewiz.local)',
        },
        body: new URLSearchParams({ data: query }).toString(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
      const json = (await res.json()) as OverpassResponse;
      process.stdout.write(`OK (${json.elements.length} elements)\n`);
      return json;
    } catch (e) {
      process.stdout.write(`FAIL (${(e as Error).message.slice(0, 80)})\n`);
      lastErr = e;
    }
  }
  throw new Error(`All Overpass mirrors failed. Last: ${String(lastErr)}`);
}

// ---------------------------------------------------------------------------
// Popularity heuristic — small bumps so well-tagged places float to the top.
// ---------------------------------------------------------------------------

function popularity(tags: Record<string, string>): number {
  let s = 10;
  // Has localized names → curated upstream.
  if (tags['name:fr']) s += 4;
  if (tags['name:ar']) s += 4;
  if (tags['name:en']) s += 2;
  if (tags['cuisine']) s += 3;
  if (tags['phone'] || tags['contact:phone']) s += 3;
  if (tags['website'] || tags['contact:website']) s += 4;
  if (tags['opening_hours']) s += 2;
  // Lower-cred markers.
  const nameLen = tags['name']?.length ?? 0;
  if (nameLen <= 2) s -= 8;
  if (nameLen > 80) s -= 3;
  // Tier per amenity — restaurants and food courts are most useful.
  const a = tags['amenity'];
  if (a === 'restaurant') s += 8;
  else if (a === 'food_court') s += 6;
  else if (a === 'cafe' || a === 'fast_food') s += 4;
  else if (a === 'bar' || a === 'pub' || a === 'biergarten') s += 2;
  return s;
}

// ---------------------------------------------------------------------------
// Map an OSM element to the JSON shape the admin bulk-import accepts.
// ---------------------------------------------------------------------------

interface SeedRow {
  name_default: string;
  name_fr: string | null;
  name_ar: string | null;
  name_en: string | null;
  lat: number;
  lng: number;
  osm_value: string;
  popularity: number;
  raw_tags: Record<string, string>;
}

function buildRow(el: OverpassElement): SeedRow | null {
  const tags = el.tags ?? {};
  const name = tags['name']?.trim();
  if (!name) return null;

  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;

  // Prefer amenity, fall back to shop, fall back to a generic 'restaurant'
  // bucket when only cuisine is set (so it lands in the right pool downstream).
  const osmValue = tags['amenity'] ?? tags['shop'] ?? 'restaurant';

  return {
    name_default: name,
    name_fr: tags['name:fr']?.trim() || null,
    name_ar: tags['name:ar']?.trim() || null,
    name_en: tags['name:en']?.trim() || null,
    lat,
    lng: lon,
    osm_value: osmValue,
    popularity: popularity(tags),
    raw_tags: tags,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const t0 = Date.now();
  const data = await fetchOverpass(OVERPASS_QUERY);

  const rows: SeedRow[] = [];
  const seen = new Set<string>(); // dedupe by (name, lat~4dp, lng~4dp)
  for (const el of data.elements) {
    const r = buildRow(el);
    if (!r) continue;
    const key = `${r.name_default}|${r.lat.toFixed(4)}|${r.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(r);
  }

  rows.sort((a, b) => b.popularity - a.popularity || a.name_default.localeCompare(b.name_default));

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.resolve(__dirname, '../seeds/restaurants-nouakchott-full.json');
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 0), 'utf8');

  // Helpful breakdown so the operator sees what they got.
  const byAmenity: Record<string, number> = {};
  for (const r of rows) byAmenity[r.osm_value] = (byAmenity[r.osm_value] ?? 0) + 1;

  console.log(`\n[done] ${rows.length} food POIs in ${Date.now() - t0}ms`);
  console.log('       breakdown:', byAmenity);
  console.log(`       written → ${outPath}`);
  console.log(`\nNext step: ouvre /restaurants dans l'admin et utilise "Importer JSON"`);
  console.log(`           (le fichier vit dans apps/api/seeds/, ou télécharge-le sur ton mac).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
