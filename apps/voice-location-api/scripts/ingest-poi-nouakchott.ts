/**
 * Ingest Nouakchott POIs from OpenStreetMap (Overpass API) into the
 * voiceloc_pois table.
 *
 * Usage:   pnpm tsx scripts/ingest-poi-nouakchott.ts
 *
 * Idempotent: re-running upserts on (osm_type, osm_id), so it's safe to
 * schedule monthly via cron to track OSM updates.
 */

import { pool } from '../src/db/pool.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Bounding box for Greater Nouakchott (slightly padded). [south, west, north, east] */
const BBOX: [number, number, number, number] = [17.92, -16.10, 18.22, -15.82];

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

/**
 * Overpass QL: pull every named feature whose tag set is useful for a
 * ride-hailing context. `out center` gives a representative lat/lng for
 * ways and relations.
 */
const OVERPASS_QUERY = `
[out:json][timeout:180];
(
  node[name][amenity](${BBOX.join(',')});
  way[name][amenity](${BBOX.join(',')});
  relation[name][amenity](${BBOX.join(',')});

  node[name][shop](${BBOX.join(',')});
  way[name][shop](${BBOX.join(',')});

  node[name][place](${BBOX.join(',')});
  way[name][place](${BBOX.join(',')});
  relation[name][place](${BBOX.join(',')});

  node[name][tourism](${BBOX.join(',')});
  way[name][tourism](${BBOX.join(',')});

  node[name][leisure](${BBOX.join(',')});
  way[name][leisure](${BBOX.join(',')});

  node[name][office](${BBOX.join(',')});
  way[name][office](${BBOX.join(',')});

  node[name][aeroway](${BBOX.join(',')});
  way[name][aeroway](${BBOX.join(',')});

  node[name][public_transport](${BBOX.join(',')});
  node[name][highway=bus_stop](${BBOX.join(',')});

  node[name][historic](${BBOX.join(',')});
  way[name][historic](${BBOX.join(',')});

  node[name][building~"^(mosque|cathedral|church|hospital|school|university|stadium)$"](${BBOX.join(',')});
  way[name][building~"^(mosque|cathedral|church|hospital|school|university|stadium)$"](${BBOX.join(',')});

  way[name][highway~"^(primary|trunk|motorway|secondary)$"](${BBOX.join(',')});
);
out center tags;
`;

// ---------------------------------------------------------------------------
// Overpass response types
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

// ---------------------------------------------------------------------------
// Popularity heuristic
// ---------------------------------------------------------------------------

/**
 * Score how useful a POI is for ride-hailing voice extraction.
 * Higher = appears earlier in the Whisper hint + fuzzy shortlists.
 *
 * Tuned for Nouakchott: places, hospitals, markets, mosques, schools,
 * stadiums, big roads — those are what people actually say.
 */
function popularityScore(tags: Record<string, string>): number {
  let score = 0;
  const place = tags['place'];
  if (place) {
    score += {
      city: 100,
      town: 80,
      suburb: 60,
      neighbourhood: 50,
      quarter: 50,
      village: 40,
      hamlet: 20,
      locality: 15,
    }[place] ?? 10;
  }

  const amenity = tags['amenity'];
  if (amenity) {
    score += {
      hospital: 50,
      university: 45,
      college: 35,
      marketplace: 45,
      place_of_worship: 30,
      school: 25,
      bank: 20,
      police: 25,
      fire_station: 25,
      bus_station: 30,
      taxi: 15,
      fuel: 15,
      pharmacy: 12,
      restaurant: 5,
      cafe: 5,
      fast_food: 4,
    }[amenity] ?? 8;
  }

  const aeroway = tags['aeroway'];
  if (aeroway === 'aerodrome' || aeroway === 'terminal') score += 70;

  const tourism = tags['tourism'];
  if (tourism === 'hotel' || tourism === 'attraction') score += 15;

  const shop = tags['shop'];
  if (shop) {
    score += { supermarket: 18, mall: 25, department_store: 18 }[shop] ?? 5;
  }

  const leisure = tags['leisure'];
  if (leisure === 'stadium' || leisure === 'sports_centre') score += 30;

  const office = tags['office'];
  if (office === 'government' || office === 'diplomatic') score += 20;

  if (tags['wikipedia'] || tags['wikidata']) score += 25;
  if (tags['name:fr']) score += 3;
  if (tags['name:ar']) score += 3;

  // Penalize ultra-short or ambiguous names ("X", "Y") and overly long ones.
  const len = tags['name']?.length ?? 0;
  if (len <= 2) score -= 20;
  if (len > 60) score -= 5;

  return score;
}

// ---------------------------------------------------------------------------
// Fetch with fallback across mirrors
// ---------------------------------------------------------------------------

async function fetchOverpass(query: string): Promise<OverpassResponse> {
  let lastErr: unknown = null;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      console.log(`[overpass] querying ${url} ...`);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          // Overpass mirrors require a meaningful UA. Contact: voice-location-api dev.
          'User-Agent': 'tewiz-voice-location-api/0.1 (Nouakchott POI ingester; contact: mohameda@tewiz.local)',
        },
        body: new URLSearchParams({ data: query }).toString(),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
      }
      return (await res.json()) as OverpassResponse;
    } catch (err) {
      console.warn(`[overpass] ${url} failed: ${(err as Error).message}`);
      lastErr = err;
    }
  }
  throw new Error(`All Overpass endpoints failed. Last error: ${String(lastErr)}`);
}

// ---------------------------------------------------------------------------
// Build search_text (lowercased, deduped, space-joined name variants)
// ---------------------------------------------------------------------------

function buildSearchText(tags: Record<string, string>): string {
  const variants = new Set<string>();
  for (const key of Object.keys(tags)) {
    if (key === 'name' || key.startsWith('name:') || key.startsWith('alt_name') || key.startsWith('official_name') || key.startsWith('short_name') || key.startsWith('loc_name')) {
      const v = tags[key]?.trim().toLowerCase();
      if (v) variants.add(v);
    }
  }
  return Array.from(variants).join(' ');
}

// ---------------------------------------------------------------------------
// Pick the primary kind/value pair (priority order)
// ---------------------------------------------------------------------------

const KIND_KEYS = [
  'place',
  'amenity',
  'aeroway',
  'tourism',
  'leisure',
  'shop',
  'office',
  'historic',
  'public_transport',
  'highway',
  'building',
] as const;

function pickKind(tags: Record<string, string>): { kind: string; value: string | null } {
  for (const k of KIND_KEYS) {
    if (tags[k]) return { kind: k, value: tags[k] };
  }
  return { kind: 'other', value: null };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const t0 = Date.now();
  const data = await fetchOverpass(OVERPASS_QUERY);
  console.log(`[overpass] received ${data.elements.length} raw elements in ${Date.now() - t0}ms`);

  // Filter, normalize, dedupe.
  type Row = {
    osm_type: string;
    osm_id: number;
    name_default: string;
    name_fr: string | null;
    name_ar: string | null;
    name_en: string | null;
    search_text: string;
    osm_kind: string;
    osm_value: string | null;
    lat: number;
    lng: number;
    popularity: number;
    raw_tags: Record<string, string>;
  };

  const rows: Row[] = [];
  for (const el of data.elements) {
    const tags = el.tags ?? {};
    const name = tags['name']?.trim();
    if (!name) continue;

    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;

    const { kind, value } = pickKind(tags);
    rows.push({
      osm_type: el.type,
      osm_id: el.id,
      name_default: name,
      name_fr: tags['name:fr']?.trim() || null,
      name_ar: tags['name:ar']?.trim() || null,
      name_en: tags['name:en']?.trim() || null,
      search_text: buildSearchText(tags),
      osm_kind: kind,
      osm_value: value,
      lat,
      lng: lon,
      popularity: popularityScore(tags),
      raw_tags: tags,
    });
  }

  console.log(`[ingest] kept ${rows.length} named POIs after filtering`);

  // Upsert in batches.
  const BATCH = 200;
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (const r of batch) {
      const base = values.length;
      values.push(
        r.osm_type,
        r.osm_id,
        r.name_default,
        r.name_fr,
        r.name_ar,
        r.name_en,
        r.search_text,
        r.osm_kind,
        r.osm_value,
        r.lat,
        r.lng,
        r.popularity,
        JSON.stringify(r.raw_tags),
      );
      const p = (n: number) => `$${base + n}`;
      tuples.push(
        `(${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)},${p(7)},${p(8)},${p(9)},${p(10)},${p(11)},${p(12)},${p(13)}::jsonb)`,
      );
    }

    const sql = `
      INSERT INTO voiceloc_pois
        (osm_type, osm_id, name_default, name_fr, name_ar, name_en,
         search_text, osm_kind, osm_value, lat, lng, popularity, raw_tags)
      VALUES ${tuples.join(',')}
      ON CONFLICT (osm_type, osm_id) DO UPDATE SET
        name_default = EXCLUDED.name_default,
        name_fr      = EXCLUDED.name_fr,
        name_ar      = EXCLUDED.name_ar,
        name_en      = EXCLUDED.name_en,
        search_text  = EXCLUDED.search_text,
        osm_kind     = EXCLUDED.osm_kind,
        osm_value    = EXCLUDED.osm_value,
        lat          = EXCLUDED.lat,
        lng          = EXCLUDED.lng,
        popularity   = EXCLUDED.popularity,
        raw_tags     = EXCLUDED.raw_tags,
        updated_at   = now()
      RETURNING (xmax = 0) AS inserted
    `;
    const { rows: results } = await pool.query<{ inserted: boolean }>(sql, values);
    for (const r of results) {
      if (r.inserted) inserted++;
      else updated++;
    }
  }

  const total = inserted + updated;
  console.log(`[ingest] done — total=${total}, inserted=${inserted}, updated=${updated}, elapsed=${Date.now() - t0}ms`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
