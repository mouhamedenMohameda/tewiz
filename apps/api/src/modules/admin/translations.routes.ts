/**
 * Admin endpoints to edit the app's i18n strings without a rebuild.
 *
 *   GET /admin/translations       — all keys grouped by namespace, with the
 *                                    `fr` value as a preview (for search/browse)
 *   GET /admin/translations/:key  — the value of one key in every language
 *   PUT /admin/translations/:key  — update one or more language values
 *
 * Keys are fixed: this never inserts/deletes a key, only updates values for
 * keys already seeded from apps/mobile/locales/*.json (see
 * scripts/seed-translations.ts). That's what keeps a typo here from ever
 * breaking a `t('some.key')` call in the app.
 *
 * Mounted under the admin router — requireAdminRole() (super_admin only,
 * same tier as /settings) is applied where this is registered.
 */

import { Router } from 'express';
import { z } from 'zod';
import { pool, withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import type { AuthedRequest } from '../../middleware/auth.js';
import { audit } from './audit.js';

export const adminTranslationsRouter = Router();

// Mirrors AppLanguage in apps/mobile/lib/i18n.ts.
const LANGS = ['fr', 'ar', 'en', 'hs', 'ff', 'wo', 'snk'] as const;
type Lang = (typeof LANGS)[number];

// ---------------------------------------------------------------------------
// GET /admin/translations
// ---------------------------------------------------------------------------

adminTranslationsRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM translations WHERE lang = 'fr' ORDER BY key`,
  );
  res.json({
    keys: rows.map((r) => ({
      key: r.key,
      namespace: r.key.split('.')[0]!,
      preview: r.value,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /admin/translations/:key
// ---------------------------------------------------------------------------

adminTranslationsRouter.get('/:key', async (req, res) => {
  const { rows } = await pool.query<{ lang: string; value: string }>(
    `SELECT lang, value FROM translations WHERE key = $1`,
    [req.params.key],
  );
  if (rows.length === 0) {
    throw new HttpError(404, 'not_found', 'Unknown translation key');
  }
  const values: Partial<Record<Lang, string>> = {};
  for (const r of rows) values[r.lang as Lang] = r.value;
  res.json({ key: req.params.key, values });
});

// ---------------------------------------------------------------------------
// PUT /admin/translations/:key
// ---------------------------------------------------------------------------

const putBody = z.object({
  values: z.record(z.enum(LANGS), z.string().min(1)).refine((v) => Object.keys(v).length > 0, {
    message: 'At least one language value is required',
  }),
  force: z.boolean().optional(),
});

const PLACEHOLDER_RE = /\{\{\s*[\w.]+\s*\}\}/g;

function placeholders(value: string): Set<string> {
  return new Set(value.match(PLACEHOLDER_RE) ?? []);
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

adminTranslationsRouter.put('/:key', async (req, res) => {
  const adminId = (req as AuthedRequest).user!.id;
  const key = req.params.key!;
  const body = putBody.parse(req.body);

  const { rows: existing } = await pool.query<{ lang: string; value: string }>(
    `SELECT lang, value FROM translations WHERE key = $1`,
    [key],
  );
  if (existing.length === 0) {
    throw new HttpError(404, 'not_found', 'Unknown translation key');
  }
  const before: Record<string, string> = {};
  for (const r of existing) before[r.lang] = r.value;

  if (!body.force) {
    const mismatches: string[] = [];
    for (const [lang, newValue] of Object.entries(body.values)) {
      const oldValue = before[lang];
      if (oldValue === undefined) continue;
      if (!sameSet(placeholders(oldValue), placeholders(newValue))) {
        mismatches.push(lang);
      }
    }
    if (mismatches.length > 0) {
      throw new HttpError(
        409,
        'placeholder_mismatch',
        `Placeholder mismatch for: ${mismatches.join(', ')}. Pass force:true to save anyway.`,
        { mismatches },
      );
    }
  }

  await withTx(async (client) => {
    for (const [lang, value] of Object.entries(body.values)) {
      await client.query(
        `UPDATE translations SET value = $1, updated_at = now(), updated_by = $2
         WHERE key = $3 AND lang = $4`,
        [value, adminId, key, lang],
      );
    }
  });

  await audit({
    adminId,
    action: 'update_translation',
    targetType: 'translation',
    targetId: key,
    before,
    after: { ...before, ...body.values },
  });

  const { rows: after } = await pool.query<{ lang: string; value: string }>(
    `SELECT lang, value FROM translations WHERE key = $1`,
    [key],
  );
  const values: Partial<Record<Lang, string>> = {};
  for (const r of after) values[r.lang as Lang] = r.value;
  res.json({ key, values });
});
