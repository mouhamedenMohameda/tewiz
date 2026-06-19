/**
 * Seed the restaurants table from seeds/restaurants-nouakchott.json.
 *
 *   pnpm --filter @tewiz/api seed:restaurants
 *
 * The JSON is the OSM-shape output produced by the voice-location-api POI
 * ingester (one entry per Overpass POI). This script normalizes it and
 * upserts via the same path the bulk-import admin endpoint uses, so calling
 * it many times is safe (UPSERT on the slug — additive merges).
 *
 * Pass a different file path as the first arg to seed a custom batch:
 *   pnpm --filter @tewiz/api seed:restaurants ./other.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, withTx } from '../src/db/pool.js';
import { fromOsmSeed, upsertRestaurant } from '../src/modules/restaurants/restaurants.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, '../seeds/restaurants-nouakchott.json');

async function main() {
  const seedPath = process.argv[2] ?? DEFAULT_PATH;
  if (!fs.existsSync(seedPath)) {
    console.error(`Seed file not found: ${seedPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(seedPath, 'utf8');
  let items: Array<Record<string, unknown>>;
  try {
    items = JSON.parse(raw);
  } catch (e) {
    console.error('Invalid JSON:', (e as Error).message);
    process.exit(1);
  }
  if (!Array.isArray(items)) {
    console.error('Seed file must contain a JSON array.');
    process.exit(1);
  }

  console.log(`[seed] loaded ${items.length} entries from ${seedPath}`);

  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  await withTx(async (client) => {
    for (let i = 0; i < items.length; i++) {
      const raw = items[i]!;
      try {
        const input = fromOsmSeed(raw);
        if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
          skipped += 1;
          errors.push(`#${i}: missing lat/lng`);
          continue;
        }
        if (!input.name.trim()) {
          skipped += 1;
          errors.push(`#${i}: empty name`);
          continue;
        }
        await upsertRestaurant(input, null, client);
        inserted += 1;
      } catch (e) {
        skipped += 1;
        errors.push(`#${i}: ${(e as Error).message.slice(0, 200)}`);
      }
    }
  });

  console.log(`[seed] done — upserted=${inserted}, skipped=${skipped}`);
  if (errors.length) {
    console.log(`[seed] first errors:\n  ${errors.slice(0, 5).join('\n  ')}`);
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
