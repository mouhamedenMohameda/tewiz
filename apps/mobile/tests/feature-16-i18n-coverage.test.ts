/**
 * FEATURE 16 — Les traductions : cliquet et hygiène structurelle.
 *
 * This file does NOT assert that the locales are complete — they are not, and
 * that target is a RED spec in tests/pending/16-locale-completeness.spec.ts —
 * the one item on the list still outstanding.
 *
 * What it does is stop things getting worse while you close that gap:
 *
 *   * a RATCHET per locale — coverage may rise freely, never fall. Adding a
 *     French key without translating it regresses every locale, and that is
 *     exactly how hs/ff/snk/wo drifted to ~56 % in the first place. RAISE the
 *     floors as translations land;
 *   * structural hygiene — no locale may blank out a string French fills, and
 *     none may drop an interpolation placeholder French declares.
 *
 * The placeholder rule already caught a real defect: ff/snk/wo rendered
 * "Entre 1 et 8." with the 8 hard coded, so raising the seat limit in admin
 * settings would have left three languages quoting a number the server no
 * longer enforces.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const LOCALES = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'locales');

type Json = Record<string, unknown>;
const load = (lang: string) => JSON.parse(readFileSync(resolve(LOCALES, `${lang}.json`), 'utf8')) as Json;

/** Every leaf key path in a nested translation object. */
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

/** French is the reference: it is the language the product is written in. */
const REFERENCE = leafKeys(load('fr'));

/**
 * Floor per locale, as measured today. RAISE these when a translation lands.
 * Never lower one to make a build pass — that is the regression this guards.
 */
const COVERAGE_FLOOR: Record<string, number> = {
  ar: 100,   // complete
  en: 95,
  hs: 57,    // hassaniya  — the everyday spoken language in Mauritania
  ff: 56,    // pulaar
  snk: 56,   // soninké
  wo: 56,    // wolof
};

function coverage(lang: string): number {
  const keys = leafKeys(load(lang));
  const present = [...REFERENCE].filter((k) => keys.has(k)).length;
  return (present / REFERENCE.size) * 100;
}

describe('the reference locale', () => {
  it('has a non-trivial number of keys', () => {
    expect(REFERENCE.size).toBeGreaterThan(1000);
  });

  it('is complete in Arabic — the other official language', () => {
    // Arabic is not optional in Mauritania. Any drift here is a release blocker,
    // which is why it sits at a 100 % floor rather than a percentage.
    expect(coverage('ar')).toBe(100);
  });

  it('ships exactly the seven locales the language picker offers', () => {
    const shipped = readdirSync(LOCALES).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
    expect(shipped.sort()).toEqual(['ar', 'en', 'ff', 'fr', 'hs', 'snk', 'wo']);
  });
});

describe('coverage ratchet — may rise, must never fall', () => {
  it.each(Object.entries(COVERAGE_FLOOR))('%s stays at or above %i%%', (lang, floor) => {
    // Fails when someone adds French copy without translating it. That is the
    // mechanism by which these four locales drifted to 56 % in the first place.
    expect(coverage(lang)).toBeGreaterThanOrEqual(floor);
  });
});

describe('structural hygiene across locales', () => {
  it.each(['ar', 'en', 'hs', 'ff', 'snk', 'wo'])(
    '%s introduces at most one key French does not have',
    (lang) => {
      const extra = [...leafKeys(load(lang))].filter((k) => !REFERENCE.has(k));
      // A key present in a translation but absent from French is dead weight —
      // it can never be rendered. One legacy stray is tolerated; a growing pile
      // means the files are drifting apart.
      expect(extra.length).toBeLessThanOrEqual(1);
    },
  );

  it.each(['ar', 'en', 'hs', 'ff', 'snk', 'wo'])(
    '%s is only ever blank where French is deliberately blank too',
    (lang) => {
      // Some keys ARE intentionally empty — `rider.current.banners.*.sub` is a
      // "this banner has no subtitle" marker, empty in every locale including
      // French. So "no empty strings" would be the wrong rule. The real
      // invariant: a locale must not blank out a string French actually fills,
      // because a blank renders as nothing at all — worse than falling back.
      const blanks = (obj: Json, prefix = '', out: string[] = []): string[] => {
        for (const [k, v] of Object.entries(obj)) {
          const path = prefix ? `${prefix}.${k}` : k;
          if (v && typeof v === 'object') blanks(v as Json, path, out);
          else if (typeof v === 'string' && v.trim() === '') out.push(path);
        }
        return out;
      };
      const frBlank = new Set(blanks(load('fr')));
      const localeBlank = blanks(load(lang));

      expect(localeBlank.filter((k) => !frBlank.has(k))).toEqual([]);
    },
  );

  it.each(['ar', 'en', 'hs', 'ff', 'snk', 'wo'])(
    '%s never drops an interpolation placeholder French declares',
    (lang) => {
      const fr = load('fr');
      const target = load(lang);
      const get = (obj: Json, path: string): unknown =>
        path.split('.').reduce<any>((acc, part) => (acc == null ? acc : acc[part]), obj);
      const vars = (s: string) =>
        new Set((s.match(/\{\{\s*(\w+)\s*\}\}/g) ?? []).map((m) => m.replace(/[{}\s]/g, '')));

      const dropped: string[] = [];
      for (const key of REFERENCE) {
        const source = get(fr, key);
        const translated = get(target, key);
        if (typeof source !== 'string' || typeof translated !== 'string') continue;
        const missing = [...vars(source)].filter((v) => !vars(translated).has(v));
        if (missing.length) dropped.push(`${key} (${missing.join(', ')})`);
      }

      // Caught a real one: ff/snk/wo rendered "Entre 1 et 8." with the 8 hard
      // coded, so raising the seat limit in admin settings would have left three
      // languages quoting a number the server no longer enforces.
      //
      // Only DROPPED placeholders are an error. An extra one is fine as long as
      // the call site supplies it — account.confirm1Body legitimately uses
      // {{app}} in Arabic where the French copy omits the brand name.
      expect(dropped).toEqual([]);
    },
  );
});
