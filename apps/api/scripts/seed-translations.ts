/**
 * Seed the `translations` table from the bundled locale JSON files
 * (apps/mobile/locales/*.json), flattening nested keys to dot-notation
 * (e.g. rider.home.title).
 *
 * Safe to re-run: uses ON CONFLICT (key, lang) DO NOTHING, so it only fills
 * in rows that don't exist yet — it never overwrites a correction already
 * made from the admin.
 *
 *   pnpm --filter @tewiz/api tsx scripts/seed-translations.ts
 *   pnpm --filter @tewiz/api tsx scripts/seed-translations.ts --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, '../../mobile/locales');

// Mirrors AppLanguage in apps/mobile/lib/i18n.ts.
const LANGS = ['fr', 'ar', 'en', 'hs', 'ff', 'wo', 'snk'] as const;

const CHUNK_SIZE = 500;

function flatten(obj: Record<string, unknown>, prefix = ''): [string, string][] {
  const rows: [string, string][] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      rows.push(...flatten(v as Record<string, unknown>, key));
    } else if (typeof v === 'string') {
      rows.push([key, v]);
    } else {
      console.warn(`Skipping non-string leaf at ${key}: ${JSON.stringify(v)}`);
    }
  }
  return rows;
}

async function insertChunk(rows: [string, string][], lang: string): Promise<number> {
  if (rows.length === 0) return 0;
  const values: string[] = [];
  const params: string[] = [];
  rows.forEach(([key, value], i) => {
    const base = i * 3;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
    params.push(key, lang, value);
  });
  const res = await pool.query(
    `INSERT INTO translations (key, lang, value)
     VALUES ${values.join(', ')}
     ON CONFLICT (key, lang) DO NOTHING`,
    params,
  );
  return res.rowCount ?? 0;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  for (const lang of LANGS) {
    const file = path.join(LOCALES_DIR, `${lang}.json`);
    if (!fs.existsSync(file)) {
      console.warn(`Missing ${file}, skipping.`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const rows = flatten(data);

    if (dryRun) {
      console.log(`[dry-run] ${lang}: would seed up to ${rows.length} keys`);
      continue;
    }

    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      inserted += await insertChunk(rows.slice(i, i + CHUNK_SIZE), lang);
    }
    console.log(
      `${lang}: ${inserted} inserted, ${rows.length - inserted} already present (skipped)`,
    );
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
