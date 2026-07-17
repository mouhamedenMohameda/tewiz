/**
 * Regenerate apps/mobile/locales/*.json from the `translations` table, so
 * corrections made from the admin get folded back into the bundled fallback
 * before the next app build/release.
 *
 * Preserves each file's existing key order/nesting (walks the on-disk JSON
 * as a template and swaps in leaf values from the DB) so re-running this
 * produces a readable git diff instead of a full alphabetical reshuffle.
 * Keys are fixed — a DB key with no match in the template, or a template
 * leaf missing from the DB, is reported but never invents/drops a key.
 *
 *   pnpm --filter @tewiz/api tsx scripts/export-translations.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, '../../mobile/locales');

const LANGS = ['fr', 'ar', 'en', 'hs', 'ff', 'wo', 'snk'] as const;

type Json = string | Json[] | { [k: string]: Json };

function applyValues(
  node: Json,
  prefix: string,
  values: Map<string, string>,
  seen: Set<string>,
): Json {
  if (typeof node === 'string') {
    const v = values.get(prefix);
    seen.add(prefix);
    if (v === undefined) {
      console.warn(`  missing in DB, keeping file value: ${prefix}`);
      return node;
    }
    return v;
  }
  if (Array.isArray(node)) {
    // Arrays (e.g. `months`) are never flattened into the DB by
    // seed-translations.ts — leave them untouched rather than turning
    // them into an object of numeric-string keys.
    return node;
  }
  const out: Record<string, Json> = {};
  for (const [k, child] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    out[k] = applyValues(child, key, values, seen);
  }
  return out;
}

async function main() {
  for (const lang of LANGS) {
    const file = path.join(LOCALES_DIR, `${lang}.json`);
    if (!fs.existsSync(file)) {
      console.warn(`Missing ${file}, skipping.`);
      continue;
    }
    const template = JSON.parse(fs.readFileSync(file, 'utf-8')) as Json;

    const { rows } = await pool.query<{ key: string; value: string }>(
      'SELECT key, value FROM translations WHERE lang = $1',
      [lang],
    );
    const values = new Map(rows.map((r) => [r.key, r.value]));

    const seen = new Set<string>();
    const updated = applyValues(template, '', values, seen);

    const unused = [...values.keys()].filter((k) => !seen.has(k));
    if (unused.length > 0) {
      console.warn(
        `${lang}: ${unused.length} DB key(s) not present in the template file, ignored: ${unused.slice(0, 5).join(', ')}${unused.length > 5 ? '…' : ''}`,
      );
    }

    fs.writeFileSync(file, JSON.stringify(updated, null, 2) + '\n');
    console.log(`${lang}: wrote ${file} (${seen.size} keys from DB)`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
