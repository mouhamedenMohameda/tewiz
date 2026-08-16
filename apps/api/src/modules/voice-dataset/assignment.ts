/**
 * Assigned-places selection.
 *
 * Picks the concrete pickup/destination POIs a tester is asked to speak, so
 * the gold label is fixed BEFORE the recording rather than chosen after it.
 * See migration 0082 for why that matters and what it costs.
 *
 * Three rules drive the choice:
 *
 *   * KNOWN PLACES. A tester who has never heard of the assigned POI either
 *     guesses or skips; the first produces noise labelled as ground truth. So
 *     candidates are drawn at random from the most POPULAR matches rather than
 *     uniformly from the corpus.
 *
 *   * UNAMBIGUOUS BY DEFAULT. A POI whose name is shared with others is only
 *     assigned when the scenario's difficulty axis is deliberately 'homonym' —
 *     that is the case the pipeline must be tested on, and the only case where
 *     the ambiguity is the point rather than an accident.
 *
 *   * A REAL TRIP. Pickup near the assigned moughataa, destination anywhere in
 *     the city but at least MIN_TRIP_M away, so the pair produces a distance
 *     the fare estimator can actually price.
 */

import { pool } from '../../db/pool.js';
import { SCENARIO_ZONES, zoneCentre, type Scenario } from './scenario.js';

/** Generous box around Nouakchott — destinations may sit anywhere inside it. */
const CITY_BOX = { minLat: 17.90, maxLat: 18.25, minLng: -16.10, maxLng: -15.80 };

/** Radius around the assigned zone centre the pickup is drawn from. */
const PICKUP_RADIUS_KM = 4;

/** Shortest trip worth pricing. Below this the fare is the base fare either way. */
const MIN_TRIP_M = 800;

/** How many popular candidates to sample from. Wide enough to vary, narrow
 *  enough that the result is a place people have actually heard of. */
const CANDIDATE_POOL = 40;

/** Landmarks shown to identify the place without naming it. */
const LANDMARK_RADIUS_M = 700;
const LANDMARK_COUNT = 3;

export interface AssignedLandmark {
  label: string;
  kind: string;
  distanceM: number;
}

export interface AssignedPlace {
  poiId: number;
  /**
   * The moughataa this POI actually sits in, nearest-centre.
   *
   * NOT the scenario's assigned zone: the destination is drawn from the whole
   * city, so labelling it with the assigned zone told testers a place in Arafat
   * was in Riyad — which is exactly what made the brief and the annotation look
   * like two different places.
   */
  district: string;
  /** Withheld by the client until after recording — see migration 0082. */
  label: string;
  nameAr: string | null;
  kind: string;
  lat: number;
  lng: number;
  /** How many POIs in the corpus share this exact folded name. 1 = unique. */
  nameCount: number;
  landmarks: AssignedLandmark[];
}

export interface Assignment {
  scenario: Scenario;
  pickup: AssignedPlace | null;
  destination: AssignedPlace | null;
  /** Straight-line metres between the two, when both are present. */
  tripDistanceM: number | null;
}

interface CandidateRow {
  id: string;
  label: string;
  name_ar: string | null;
  kind: string;
  lat: number;
  lng: number;
  name_count: number;
}

/**
 * Folded-name frequency across the whole corpus, plus the display fields.
 *
 * Ambiguity is defined as an exact match on the ACCENT-FOLDED display name
 * (voiceloc_fold, migration 0081): "Carrefour Madrid" appearing three times is
 * the real failure mode, and a looser trigram definition would flag half the
 * "Carrefour …" family as ambiguous with each other, which they are not — a
 * rider saying "Carrefour Madrid" is not ambiguous at all.
 */
const CANDIDATE_CTE = `
  WITH labelled AS (
    SELECT id,
           COALESCE(NULLIF(name_fr, ''), name_default) AS label,
           name_ar,
           COALESCE(osm_value, osm_kind) AS kind,
           lat, lng, popularity
      FROM voiceloc_pois
     WHERE length(COALESCE(NULLIF(name_fr, ''), name_default)) >= 3
  ),
  counts AS (
    SELECT voiceloc_fold(label) AS fold, COUNT(*)::int AS n
      FROM labelled GROUP BY 1
  ),
  candidates AS (
    SELECT l.*, c.n AS name_count
      FROM labelled l JOIN counts c ON c.fold = voiceloc_fold(l.label)
  )
`;

/**
 * Draw one POI inside a bounding box.
 *
 * `wantHomonym` flips the ambiguity filter. Both branches fall back to the
 * other side rather than returning nothing: a zone with no unique-named POI
 * should still yield an assignment, because an imperfect one beats a tester
 * staring at an error.
 */
async function drawPlace(opts: {
  box: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  wantHomonym: boolean;
  excludeId?: number;
  awayFrom?: { lat: number; lng: number; minMetres: number };
}): Promise<CandidateRow | null> {
  const params: unknown[] = [
    opts.box.minLat, opts.box.maxLat, opts.box.minLng, opts.box.maxLng,
    opts.excludeId ?? null,
  ];

  let distanceSql = '';
  if (opts.awayFrom) {
    // Degrees squared against a degree-converted threshold — cheap, and
    // monotonic in true distance at city scale.
    //
    // The cos(latitude) factor on the longitude term is NOT cosmetic: without
    // it a degree of longitude is treated as a degree of latitude, and a pair
    // separated mostly east-west clears an 800 m threshold at a true 760 m.
    // Measured: pairs came back at 773 m. metresBetween() below applies the
    // same factor, so both now speak the same metric — a filter and a
    // measurement that disagree is how a bound silently stops holding.
    const degrees = opts.awayFrom.minMetres / 111_000;
    params.push(opts.awayFrom.lat, opts.awayFrom.lng, degrees * degrees);
    const lat = `$${params.length - 2}`;
    const lng = `$${params.length - 1}`;
    distanceSql = `AND ((lat - ${lat}) * (lat - ${lat})
                      + ((lng - ${lng}) * cos(radians(${lat})))
                      * ((lng - ${lng}) * cos(radians(${lat}))))
                     > $${params.length}`;
  }

  const run = async (homonym: boolean): Promise<CandidateRow | null> => {
    const { rows } = await pool.query<CandidateRow>(
      `${CANDIDATE_CTE}
       SELECT id, label, name_ar, kind, lat, lng, name_count FROM (
         SELECT * FROM candidates
          WHERE lat BETWEEN $1 AND $2
            AND lng BETWEEN $3 AND $4
            AND ($5::bigint IS NULL OR id <> $5::bigint)
            AND name_count ${homonym ? '> 1' : '= 1'}
            ${distanceSql}
          ORDER BY popularity DESC
          LIMIT ${CANDIDATE_POOL}
       ) pool
       ORDER BY random()
       LIMIT 1`,
      params,
    );
    return rows[0] ?? null;
  };

  return (await run(opts.wantHomonym)) ?? (await run(!opts.wantHomonym));
}

/** Nearby POIs used to identify a place on screen without writing its name. */
async function landmarksFor(place: CandidateRow): Promise<AssignedLandmark[]> {
  const dLat = LANDMARK_RADIUS_M / 111_000;
  const dLng = dLat / Math.cos((place.lat * Math.PI) / 180);

  const { rows } = await pool.query<{ label: string; kind: string; distance_m: number }>(
    `${CANDIDATE_CTE}
     SELECT label, kind,
            -- Equirectangular approximation: exact enough under a kilometre,
            -- and PostGIS is not available on this table (migration 0012).
            round(111000 * sqrt(
              (lat - $1) * (lat - $1)
              + ((lng - $2) * cos(radians($1))) * ((lng - $2) * cos(radians($1)))
            ))::int AS distance_m
       FROM candidates
      WHERE id <> $3::bigint
        AND lat BETWEEN $1 - $4 AND $1 + $4
        AND lng BETWEEN $2 - $5 AND $2 + $5
        AND voiceloc_fold(label) <> voiceloc_fold($6)
      ORDER BY popularity DESC
      LIMIT $7`,
    [place.lat, place.lng, place.id, dLat, dLng, place.label, LANDMARK_COUNT],
  );

  return rows.map((r) => ({ label: r.label, kind: r.kind, distanceM: r.distance_m }));
}

async function toPlace(row: CandidateRow): Promise<AssignedPlace> {
  return {
    poiId: Number(row.id),
    district: nearestZone(row.lat, row.lng),
    label: row.label,
    nameAr: row.name_ar,
    kind: row.kind,
    lat: row.lat,
    lng: row.lng,
    nameCount: row.name_count,
    landmarks: await landmarksFor(row),
  };
}

/** Nearest moughataa centre to a coordinate — the POI's own district. */
function nearestZone(lat: number, lng: number): string {
  // Widened to string: SCENARIO_ZONES is `as const`, so holding an element in a
  // mutable binding would pin it to the first entry's literal code type.
  let bestCode: string = SCENARIO_ZONES[0]!.code;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const zone of SCENARIO_ZONES) {
    const dLat = lat - zone.lat;
    const dLng = (lng - zone.lng) * Math.cos((lat * Math.PI) / 180);
    const d = dLat * dLat + dLng * dLng;
    if (d < bestDist) { bestDist = d; bestCode = zone.code; }
  }
  return bestCode;
}

function metresBetween(a: AssignedPlace, b: AssignedPlace): number {
  const dLat = (a.lat - b.lat) * 111_000;
  const dLng = (a.lng - b.lng) * 111_000 * Math.cos((a.lat * Math.PI) / 180);
  return Math.round(Math.sqrt(dLat * dLat + dLng * dLng));
}

/**
 * Build the full assignment for a scenario.
 *
 * Which endpoints are drawn follows the structure the scenario asks for, so a
 * "pickup_only" assignment never shows a destination the tester would then feel
 * obliged to mention.
 */
export async function buildAssignment(scenario: Scenario): Promise<Assignment> {
  const centre = zoneCentre(scenario.zone);
  const dLat = PICKUP_RADIUS_KM / 111;
  const dLng = centre ? dLat / Math.cos((centre.lat * Math.PI) / 180) : dLat;

  const pickupBox = centre
    ? {
      minLat: centre.lat - dLat, maxLat: centre.lat + dLat,
      minLng: centre.lng - dLng, maxLng: centre.lng + dLng,
    }
    : CITY_BOX;

  const wantHomonym = scenario.difficulty === 'homonym';
  const needsPickup = scenario.structure !== 'destination_only';
  const needsDestination = scenario.structure === 'from_to'
    || scenario.structure === 'round_trip'
    || scenario.structure === 'destination_only';

  const pickupRow = needsPickup
    ? await drawPlace({ box: pickupBox, wantHomonym })
    : null;
  const pickup = pickupRow ? await toPlace(pickupRow) : null;

  const destinationRow = needsDestination
    ? await drawPlace({
      box: CITY_BOX,
      // Only one endpoint carries the homonym: two ambiguous places in one
      // request tests nothing in particular and is simply hard to speak.
      wantHomonym: wantHomonym && !pickup,
      excludeId: pickup?.poiId,
      ...(pickup
        ? { awayFrom: { lat: pickup.lat, lng: pickup.lng, minMetres: MIN_TRIP_M } }
        : {}),
    })
    : null;
  const destination = destinationRow ? await toPlace(destinationRow) : null;

  return {
    scenario,
    pickup,
    destination,
    tripDistanceM: pickup && destination ? metresBetween(pickup, destination) : null,
  };
}
