/**
 * Scenario assignment for voice-dataset collection.
 *
 * The problem this solves: testers left to their own devices record the same
 * trips, in the same quiet room, in the same phrasing. A corpus built that way
 * scores every architecture identically because it never exercises the cases
 * that separate them — round trips, homonyms, street noise, code-switching.
 *
 * So the server hands out an assignment before each recording, picking on each
 * axis whichever value is currently least represented. The tester is told the
 * *shape* of what to record ("aller-retour, dans la rue, hassaniya pur, dans
 * Arafat") but never the place names — those they choose from their own life,
 * which is what keeps the speech natural.
 *
 * Coverage is measured per axis (marginal), not per combination (joint). The
 * joint space is 2880 cells; a few hundred samples leave almost all of them
 * empty and the notion of "coverage" stops meaning anything. The ~26 marginal
 * buckets do reach usable counts, and per-bucket accuracy on them is what
 * tells you *where* a pipeline breaks.
 *
 * Collection is uniform across each axis rather than matched to production
 * traffic. That is deliberate: uniform sampling gives every bucket enough
 * samples to measure, which is the point of an evaluation set. It does mean
 * the unweighted headline accuracy is NOT an estimate of production accuracy —
 * the axes are stored on every row precisely so the harness can re-weight by
 * real traffic priors when it wants that number.
 */

import { pool } from '../../db/pool.js';

export const SCENARIO_STRUCTURES = [
  'pickup_only',
  'destination_only',
  'from_to',
  'round_trip',
  'open_ride',
] as const;

export const SCENARIO_NOISES = [
  'quiet_indoor',
  'street',
  'moving_car',
  'wind',
] as const;

export const SCENARIO_LANGUAGES = [
  'hassaniya',
  'hassaniya_french',
  'french',
  'arabic',
] as const;

export const SCENARIO_DIFFICULTIES = [
  'plain',
  'landmarks',
  'homonym',
  'vague',
] as const;

export type ScenarioStructure = (typeof SCENARIO_STRUCTURES)[number];
export type ScenarioNoise = (typeof SCENARIO_NOISES)[number];
export type ScenarioLanguage = (typeof SCENARIO_LANGUAGES)[number];
export type ScenarioDifficulty = (typeof SCENARIO_DIFFICULTIES)[number];

/**
 * Nouakchott's moughataas and their centroids.
 *
 * The five marked "referenced" come from published coordinates supplied by the
 * project owner. They replaced hand-set guesses of mine that were wrong by
 * kilometres — Riyad by 4.8, Teyarett by 4.3, Arafat by 3.4 — which is how the
 * Arafat neighbourhood Elveloudja came to be assigned under El Mina.
 *
 * The four marked "unverified" are still my originals; no published figure was
 * available for them. Replace them when one is: the error they carry is
 * invisible until a tester recognises a misplaced neighbourhood, as happened
 * with Arafat.
 *
 * These centroids now partition the city rather than seed radii — see
 * ZONE_ASSIGNMENT_SQL in assignment.ts. That matters because the real centres
 * sit as little as 2 km apart (Arafat to El Mina), so any radius wide enough
 * to be useful necessarily crossed into the neighbour.
 */
export const SCENARIO_ZONES = [
  { code: 'tevragh_zeina', lat: 18.0958, lng: -15.9785 }, // unverified
  { code: 'ksar', lat: 18.0900, lng: -15.9600 },          // unverified
  { code: 'sebkha', lat: 18.0700, lng: -15.9800 },        // unverified
  { code: 'dar_naim', lat: 18.1400, lng: -15.9500 },      // unverified
  { code: 'riyad', lat: 18.0107, lng: -15.9553 },         // referenced
  { code: 'arafat', lat: 18.0464, lng: -15.9719 },        // referenced
  { code: 'toujounine', lat: 18.0833, lng: -15.9000 },    // referenced
  { code: 'el_mina', lat: 18.0650, lng: -15.9771 },       // referenced
  { code: 'teyarett', lat: 18.1278, lng: -15.9392 },      // referenced
] as const;

export type ScenarioZone = (typeof SCENARIO_ZONES)[number]['code'];

// Widened to string[] on purpose: this list is matched against untrusted
// request values, and a literal-union element type makes `.includes(someString)`
// a type error at exactly the call site that needs it most.
export const SCENARIO_ZONE_CODES: readonly string[] = SCENARIO_ZONES.map((z) => z.code);

export function zoneCentre(code: string): { lat: number; lng: number } | null {
  const zone = SCENARIO_ZONES.find((z) => z.code === code);
  return zone ? { lat: zone.lat, lng: zone.lng } : null;
}

export interface Scenario {
  structure: ScenarioStructure;
  noise: ScenarioNoise;
  language: ScenarioLanguage;
  difficulty: ScenarioDifficulty;
  zone: string;
}

/** One axis value and how many usable samples currently carry it. */
export interface AxisBucket {
  value: string;
  count: number;
}

export interface Coverage {
  structure: AxisBucket[];
  noise: AxisBucket[];
  language: AxisBucket[];
  difficulty: AxisBucket[];
  zone: AxisBucket[];
  /** Samples counted into the buckets above (i.e. everything not rejected). */
  total: number;
}

const AXIS_COLUMNS = {
  structure: 'scenario_structure',
  noise: 'scenario_noise',
  language: 'scenario_language',
  difficulty: 'scenario_difficulty',
  zone: 'scenario_zone',
} as const;

const AXIS_VALUES: Record<keyof typeof AXIS_COLUMNS, readonly string[]> = {
  structure: SCENARIO_STRUCTURES,
  noise: SCENARIO_NOISES,
  language: SCENARIO_LANGUAGES,
  difficulty: SCENARIO_DIFFICULTIES,
  zone: SCENARIO_ZONE_CODES,
};

/**
 * Per-axis counts over every sample that is not rejected.
 *
 * Rejected samples are excluded because they will never reach an evaluation
 * split — counting them would tell the assigner a bucket is full when it holds
 * nothing usable, and that bucket would then stay permanently starved.
 */
export async function getCoverage(): Promise<Coverage> {
  const { rows } = await pool.query<{ axis: string; value: string; count: string }>(
    Object.entries(AXIS_COLUMNS)
      .map(
        ([axis, column]) => `
          SELECT '${axis}' AS axis, ${column} AS value, COUNT(*)::text AS count
            FROM voice_dataset_samples
           WHERE status <> 'rejected'
           GROUP BY ${column}`,
      )
      .join('\nUNION ALL'),
  );

  const counted = new Map<string, number>();
  for (const r of rows) counted.set(`${r.axis}:${r.value}`, Number(r.count));

  // Build from the canonical value lists, not from the query result, so a
  // bucket with zero samples still appears — those are exactly the ones the
  // assigner and the admin dashboard need to see.
  const build = (axis: keyof typeof AXIS_COLUMNS): AxisBucket[] =>
    AXIS_VALUES[axis].map((value) => ({
      value,
      count: counted.get(`${axis}:${value}`) ?? 0,
    }));

  const structure = build('structure');
  return {
    structure,
    noise: build('noise'),
    language: build('language'),
    difficulty: build('difficulty'),
    zone: build('zone'),
    // Summing one axis gives the sample total: every row carries exactly one
    // value on every axis (all five columns are NOT NULL).
    total: structure.reduce((sum, b) => sum + b.count, 0),
  };
}

/**
 * Pick the least-covered value on an axis.
 *
 * Ties are broken at random rather than by list order. With deterministic tie-
 * breaking, an empty corpus hands every tester the identical first assignment,
 * and several testers recording in parallel all fill the same bucket before
 * any of them sees a different one.
 */
function leastCovered(buckets: AxisBucket[]): string {
  const min = Math.min(...buckets.map((b) => b.count));
  const candidates = buckets.filter((b) => b.count === min);
  return candidates[Math.floor(Math.random() * candidates.length)]!.value;
}

/** The scenario a tester should record next, given current coverage. */
export async function nextScenario(): Promise<Scenario> {
  const coverage = await getCoverage();
  return {
    structure: leastCovered(coverage.structure) as ScenarioStructure,
    noise: leastCovered(coverage.noise) as ScenarioNoise,
    language: leastCovered(coverage.language) as ScenarioLanguage,
    difficulty: leastCovered(coverage.difficulty) as ScenarioDifficulty,
    zone: leastCovered(coverage.zone),
  };
}
