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
  hs: 59,    // hassaniya  — the everyday spoken language in Mauritania
  ff: 58,    // pulaar
  snk: 58,   // soninké
  wo: 58,    // wolof
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

/**
 * Catégories de pluriel exigées par une langue (CLDR, via Intl).
 *
 * L'arabe en a SIX (zero/one/two/few/many/other) là où le français et l'anglais
 * n'en ont que deux. Une traduction arabe qui ne fournit que `_one` et
 * `_other` laisse i18next sans correspondance pour 3-10 (few), 11-99 (many),
 * 0 et 2 — il retombe alors sur le français, en pleine interface arabe.
 */
function pluralCategories(lang: string): string[] {
  // `hs` (hassaniya) n'est pas un code CLDR : Intl le rejette. C'est de
  // l'arabe dialectal, il suit donc les mêmes règles de pluriel.
  const cldr = lang === 'hs' ? 'ar' : lang;
  let rules: Intl.PluralRules;
  try {
    rules = new Intl.PluralRules(cldr);
  } catch {
    return ['one', 'other'];
  }
  // On prend les catégories ATTEIGNABLES sur 0-200, pas la liste théorique de
  // CLDR : le français déclare un `many` que seul un compte >= 1 000 000
  // déclenche. Exiger cette forme pour « éléments restants » ou « résultats »
  // ferait écrire une phrase que personne ne lira jamais. L'arabe, lui,
  // traverse ses six catégories bien avant 200 — le cas qu'on veut attraper.
  const reachable = new Set<string>();
  for (let n = 0; n <= 200; n++) reachable.add(rules.select(n));
  return [...reachable];
}

const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** "a.b.subtitle_few" -> "a.b.subtitle" ; sinon null. */
function pluralBase(key: string): string | null {
  for (const suf of PLURAL_SUFFIXES) {
    if (key.endsWith(`_${suf}`)) return key.slice(0, -(suf.length + 1));
  }
  return null;
}

describe('les formes de pluriel couvrent les catégories de la langue', () => {
  // Le bug attrapé ici : la carte « Complétez votre profil » affichait sa
  // phrase EN FRANÇAIS dans une interface arabe dès que 4 éléments manquaient.
  // 4 tombe dans la catégorie `few`, absente de ar.json — repli sur le
  // français. Rien ne le signalait : la clé existait, elle était juste
  // incomplète.
  it.each(['ar', 'en', 'fr', 'hs', 'ff', 'snk', 'wo'])(
    '%s fournit toutes les catégories que sa langue exige',
    (lang) => {
      const needed = pluralCategories(lang);
      const keys = leafKeys(load(lang));
      const bases = new Map<string, Set<string>>();
      for (const k of keys) {
        const base = pluralBase(k);
        if (!base) continue;
        if (!bases.has(base)) bases.set(base, new Set());
        bases.get(base)!.add(k.slice(base.length + 1));
      }
      const gaps: string[] = [];
      for (const [base, have] of bases) {
        const missing = needed.filter((c) => !have.has(c));
        if (missing.length) gaps.push(`${base} -> manque ${missing.join(', ')}`);
      }
      expect(gaps).toEqual([]);
    },
  );
});

describe('structural hygiene across locales', () => {
  it.each(['ar', 'en', 'hs', 'ff', 'snk', 'wo'])(
    '%s introduces at most one key French does not have',
    (lang) => {
      // Les variantes de pluriel que le français n'a pas ne sont PAS du poids
      // mort : l'arabe a besoin de `_few` et `_many` là où le français se
      // contente de `_one`/`_other`. On ne compare donc que les bases.
      const frBases = new Set([...REFERENCE].map((k) => pluralBase(k) ?? k));
      const extra = [...leafKeys(load(lang))].filter(
        (k) => !REFERENCE.has(k) && !frBases.has(pluralBase(k) ?? k),
      );
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
        // `{{count}}` est légitimement absent des formes zero/one/two : la
        // grammaire porte le nombre elle-même. « بقي عنصر واحد » est correct,
        // « بقي 1 عنصر » ne l'est pas. Les formes few/many/other, elles,
        // doivent bien afficher le nombre.
        const suffix = key.slice((pluralBase(key) ?? key).length + 1);
        const exempt = ['zero', 'one', 'two'].includes(suffix) ? new Set(['count']) : new Set<string>();
        const missing = [...vars(source)]
          .filter((v) => !vars(translated).has(v) && !exempt.has(v));
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
