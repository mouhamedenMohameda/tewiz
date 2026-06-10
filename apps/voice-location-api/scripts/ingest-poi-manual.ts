/**
 * Manual POI seed importer.
 *
 * Reads seeds/manual-pois.json and upserts entries into voiceloc_pois.
 *
 * Use this to add Nouakchott landmarks that OSM doesn't have but that
 * users actually say out loud — typically "Carrefour X" intersections,
 * informal neighborhood names, and shops popular enough to be used as
 * landmarks.
 *
 * JSON shape (array of objects):
 * {
 *   "name_default": "Carrefour Oum Ghasser",
 *   "name_fr": "Carrefour Oum Ghasser",
 *   "name_ar": "كرفور أم قصر",
 *   "alt_names": ["Oum Ksar", "Oum Ghasser", "أم قصر"],
 *   "lat": 18.0712,
 *   "lng": -15.9543,
 *   "osm_kind": "amenity",       // free-form category, kept for compat
 *   "osm_value": "marketplace",
 *   "popularity": 60
 * }
 *
 * Usage: pnpm tsx scripts/ingest-poi-manual.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/pool.js';

interface ManualSeed {
  name_default: string;
  name_fr?: string | null;
  name_ar?: string | null;
  name_en?: string | null;
  alt_names?: string[];
  lat: number;
  lng: number;
  osm_kind?: string;
  osm_value?: string | null;
  popularity?: number;
  google_place_id?: string | null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.resolve(__dirname, '../seeds/manual-pois.json');

function buildSearchText(s: ManualSeed): string {
  const variants = new Set<string>();
  for (const v of [s.name_default, s.name_fr, s.name_ar, s.name_en, ...(s.alt_names ?? [])]) {
    const cleaned = v?.trim().toLowerCase();
    if (cleaned) variants.add(cleaned);
  }
  return Array.from(variants).join(' ');
}

/**
 * Manual seeds use osm_type='manual' and a synthetic negative osm_id
 * (hash of name+lat+lng) so they coexist with real OSM rows without
 * clashing on the (osm_type, osm_id) unique constraint and so the same
 * seed re-imports as an UPDATE not an INSERT.
 */
function synthOsmId(s: ManualSeed): number {
  const key = `${s.name_default}|${s.lat.toFixed(5)}|${s.lng.toFixed(5)}`;
  // Simple deterministic hash → fits in 31 bits → fits in bigint trivially.
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  // Negative so it can never collide with a real OSM id (positive).
  return -(Math.abs(h) || 1);
}

async function main() {
  if (!fs.existsSync(SEED_PATH)) {
    console.error(`Seed file not found: ${SEED_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(SEED_PATH, 'utf8');
  const seeds = JSON.parse(raw) as ManualSeed[];
  if (!Array.isArray(seeds)) {
    console.error('Seed file must contain a JSON array.');
    process.exit(1);
  }

  console.log(`[seed] loaded ${seeds.length} entries from ${SEED_PATH}`);

  let inserted = 0;
  let updated = 0;
  for (const s of seeds) {
    if (!s.name_default || typeof s.lat !== 'number' || typeof s.lng !== 'number') {
      console.warn(`[seed] skipping invalid entry: ${JSON.stringify(s).slice(0, 80)}`);
      continue;
    }

    const tagsForRaw: Record<string, string> = {
      name: s.name_default,
      ...(s.name_fr ? { 'name:fr': s.name_fr } : {}),
      ...(s.name_ar ? { 'name:ar': s.name_ar } : {}),
      ...(s.name_en ? { 'name:en': s.name_en } : {}),
      ...(s.alt_names?.length ? { alt_name: s.alt_names.join(';') } : {}),
      source: 'manual',
    };

    // Drop the unique constraint friendliness check by using ON CONFLICT.
    const { rows } = await pool.query<{ inserted: boolean }>(
      `INSERT INTO voiceloc_pois
        (osm_type, osm_id, name_default, name_fr, name_ar, name_en,
         search_text, osm_kind, osm_value, lat, lng, popularity,
         google_place_id, raw_tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
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
         google_place_id = EXCLUDED.google_place_id,
         raw_tags     = EXCLUDED.raw_tags,
         updated_at   = now()
       RETURNING (xmax = 0) AS inserted`,
      [
        'node', // We piggyback on the 'node' osm_type so the CHECK
                // constraint is happy; the synthetic osm_id stays negative.
        synthOsmId(s),
        s.name_default,
        s.name_fr ?? null,
        s.name_ar ?? null,
        s.name_en ?? null,
        buildSearchText(s),
        s.osm_kind ?? 'manual',
        s.osm_value ?? null,
        s.lat,
        s.lng,
        s.popularity ?? 30,
        s.google_place_id ?? null,
        JSON.stringify(tagsForRaw),
      ],
    );

    if (rows[0]?.inserted) inserted++;
    else updated++;
  }

  console.log(`[seed] done — inserted=${inserted}, updated=${updated}`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
