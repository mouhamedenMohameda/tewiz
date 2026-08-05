/**
 * SPEC — Feature #16 : les sept langues doivent être complètes.
 *
 * ACCEPTANCE CRITERIA
 *
 *   Every shipped locale covers 100 % of the French reference keys.
 *
 * Current state, measured against fr.json (1345 keys):
 *
 *     ar   100.0 %   ✅
 *     en    95.2 %   64 keys missing
 *     hs    57.2 %   575 keys missing   ← hassaniya, the everyday spoken language
 *     ff    56.1 %   590 keys missing   ← pulaar
 *     snk   56.1 %   590 keys missing   ← soninké
 *     wo    56.1 %   590 keys missing   ← wolof
 *
 * WHY THIS IS NOT COSMETIC
 *
 * The missing 44 % is not the easy 44 %. Those keys were added after the first
 * translation pass, which means the newest screens are the ones that fall back
 * to French — a user picks Wolof, the home screen speaks Wolof, and then the
 * booking flow does not. Offering a language you only half support is worse
 * than not offering it, because the user cannot predict which screen will speak
 * to them.
 *
 * WORKING ON THIS
 *
 * `pnpm --filter @tewiz/api export:translations` and `seed:translations` exist,
 * and the admin has a translations screen — you do not have to hand-edit JSON.
 * The failure output below lists the missing sections per locale so the work
 * can be handed out in coherent chunks rather than as 590 loose strings.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const LOCALES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'locales');

type Json = Record<string, unknown>;
const load = (lang: string) =>
  JSON.parse(readFileSync(resolve(LOCALES, `${lang}.json`), 'utf8')) as Json;

function leafKeys(obj: Json, prefix = ''): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const nested of leafKeys(v as Json, path)) out.add(nested);
    } else {
      out.add(path);
    }
  }
  return out;
}

const REFERENCE = leafKeys(load('fr'));

function missingIn(lang: string): string[] {
  const keys = leafKeys(load(lang));
  return [...REFERENCE].filter((k) => !keys.has(k));
}

/** Missing keys grouped by top-level section, biggest gaps first. */
function missingBySection(lang: string): string {
  const bySection = new Map<string, number>();
  for (const key of missingIn(lang)) {
    const section = key.split('.')[0]!;
    bySection.set(section, (bySection.get(section) ?? 0) + 1);
  }
  return [...bySection.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([s, n]) => `${s}:${n}`)
    .join(', ');
}

const LOCALES_TO_COMPLETE = ['en', 'hs', 'ff', 'snk', 'wo'] as const;

describe('every shipped locale is complete', () => {
  it.each(LOCALES_TO_COMPLETE)('%s covers all French keys', (lang) => {
    const missing = missingIn(lang);
    const pct = (((REFERENCE.size - missing.length) / REFERENCE.size) * 100).toFixed(1);

    expect(
      missing.length,
      `${lang} is at ${pct}% (${missing.length} of ${REFERENCE.size} keys missing). `
      + `Biggest gaps — ${missingBySection(lang)}`,
    ).toBe(0);
  });
});

describe('the languages Mauritanians actually speak come first', () => {
  it('hassaniya is complete', () => {
    // Not one of seven equal options: it is the everyday spoken language. A
    // captain who reads it and little French is the exact user this app needs.
    const missing = missingIn('hs');
    expect(
      missing.length,
      `Hassaniya is missing ${missing.length} keys — ${missingBySection('hs')}`,
    ).toBe(0);
  });

  it.each(['ff', 'snk', 'wo'])('%s is complete', (lang) => {
    const missing = missingIn(lang);
    expect(
      missing.length,
      `${lang} is missing ${missing.length} keys — ${missingBySection(lang)}`,
    ).toBe(0);
  });
});

describe('the core ride flow is translated everywhere, even before the rest', () => {
  // If the full sweep is too large to land at once, do these sections first:
  // they are the screens a user cannot avoid.
  const CRITICAL_PREFIXES = ['rider.current', 'rider.newRide', 'captain.rides', 'common'];

  it.each(LOCALES_TO_COMPLETE)('%s covers the critical ride-flow sections', (lang) => {
    const keys = leafKeys(load(lang));
    const missing = [...REFERENCE]
      .filter((k) => CRITICAL_PREFIXES.some((p) => k.startsWith(p)))
      .filter((k) => !keys.has(k));

    expect(
      missing.length,
      `${lang} falls back to French on ${missing.length} core ride-flow strings, e.g. ${missing.slice(0, 5).join(', ')}`,
    ).toBe(0);
  });
});
