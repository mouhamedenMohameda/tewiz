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

/**
 * Radius within which a category must be UNIQUE for the descriptor to identify
 * the place. Roughly district scale, which is the granularity the card shows.
 */
const DESCRIPTOR_UNIQUE_RADIUS_M = 2000;

/** Landmarks shown to identify the place without naming it. */
const LANDMARK_RADIUS_M = 700;
const LANDMARK_COUNT = 3;

/**
 * Categories a place must belong to before it can be assigned.
 *
 * The first version drew from raw OSM popularity and handed testers things like
 * "an electronics shop" (Aziz Telecom). That failed twice over:
 *
 *   * UNIDENTIFIABLE. Category plus district plus landmarks only pins a place
 *     down when the category is itself distinguishing. There is one maternity
 *     in Sebkha; there are fifty phone shops.
 *   * UNREALISTIC. No rider asks a taxi for "the electronics shop". They name
 *     landmarks — the maternity, Mgeysira market, Carrefour Madrid — so a
 *     corpus built on small shops tests speech the pipeline will never hear.
 *
 * Restricting to landmark-grade categories fixes both at once, and has a third
 * effect that resolves the tension in this whole screen: for these kinds the
 * descriptor and the spoken name converge. "A maternity · Sebkha" reads as
 * "the maternity in Sebkha" — identifying, without ever printing the label the
 * tester would otherwise read aloud.
 *
 * The long tail stays fully searchable in free mode; it is only barred from
 * being ASSIGNED.
 */
const ASSIGNABLE_KINDS = [
  // Neighbourhoods and localities — what riders name most often.
  'suburb', 'neighbourhood', 'quarter', 'city', 'town', 'village', 'locality',
  // Civic and health landmarks.
  'hospital', 'clinic', 'doctors', 'maternity', 'pharmacy',
  'university', 'college', 'school', 'kindergarten',
  'police', 'townhall', 'courthouse', 'post_office', 'prison', 'embassy',
  // Commerce at landmark scale — a market, not a stall.
  'marketplace', 'supermarket', 'mall',
  // Movement.
  'bus_station', 'taxi', 'fuel', 'aerodrome', 'airport', 'ferry_terminal',
  'crossing', 'junction', 'roundabout', 'motorway_junction',
  // Worship, leisure, hospitality.
  'place_of_worship', 'mosque', 'stadium', 'sports_centre', 'pitch', 'park',
  'hotel', 'restaurant',
] as const;

/** SQL fragment restricting candidates to the assignable categories. */
const ASSIGNABLE_FILTER = `kind = ANY(ARRAY[${
  ASSIGNABLE_KINDS.map((k) => `'${k}'`).join(',')
}])`;

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
  /**
   * How many POIs of the SAME category sit within ~2 km. 1 = the descriptor
   * shown on screen ("a maternity · Sebkha") designates one place.
   *
   * This, not the category list, is what makes an assignment answerable. The
   * previous rule kept "school" because schools are ride destinations — but
   * Ksar has twenty, so "a school · Ksar" identified nothing.
   */
  descriptorCount: number;
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
  descriptor_count: number;
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

  const run = async (
    homonym: boolean, landmarkGrade: boolean, uniqueDescriptor: boolean,
  ): Promise<CandidateRow | null> => {
    const { rows } = await pool.query<CandidateRow>(
      `${CANDIDATE_CTE}
       SELECT id, label, name_ar, kind, lat, lng, name_count, descriptor_count FROM (
         SELECT p.*, (
           SELECT COUNT(*) FROM candidates c2
            WHERE c2.kind = p.kind
              AND c2.lat BETWEEN p.lat - ${DESCRIPTOR_UNIQUE_RADIUS_M / 111000}
                             AND p.lat + ${DESCRIPTOR_UNIQUE_RADIUS_M / 111000}
              AND c2.lng BETWEEN p.lng - ${DESCRIPTOR_UNIQUE_RADIUS_M / 111000} / cos(radians(p.lat))
                             AND p.lng + ${DESCRIPTOR_UNIQUE_RADIUS_M / 111000} / cos(radians(p.lat))
         )::int AS descriptor_count
         FROM (
           SELECT * FROM candidates
            WHERE lat BETWEEN $1 AND $2
              AND lng BETWEEN $3 AND $4
              AND ($5::bigint IS NULL OR id <> $5::bigint)
              AND name_count ${homonym ? '> 1' : '= 1'}
              ${landmarkGrade ? `AND ${ASSIGNABLE_FILTER}` : ''}
              ${distanceSql}
            ORDER BY popularity DESC
            LIMIT ${CANDIDATE_POOL}
         ) p
       ) pool
       ${uniqueDescriptor ? 'WHERE descriptor_count = 1' : ''}
       ORDER BY random()
       LIMIT 1`,
      params,
    );
    return rows[0] ?? null;
  };

  // Preference order, most answerable first: a landmark-grade category whose
  // descriptor is locally unique, then a unique descriptor of any category,
  // then landmark-grade without uniqueness, then anything. Each relaxation
  // makes the place harder to recognise from its description alone — which is
  // why the screen offers to reveal the name rather than assuming the tester
  // will manage.
  return (await run(opts.wantHomonym, true, true))
    ?? (await run(!opts.wantHomonym, true, true))
    ?? (await run(opts.wantHomonym, false, true))
    ?? (await run(opts.wantHomonym, true, false))
    ?? (await run(!opts.wantHomonym, true, false))
    ?? (await run(!opts.wantHomonym, false, false));
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
    descriptorCount: row.descriptor_count,
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

  // Report the structure that was actually assignable, not the one asked for.
  // A sparse corner of the corpus can leave an endpoint undrawable, and a brief
  // announcing "from X to Y" while showing one place reads as a bug to the
  // tester — and would be recorded against the wrong structure label.
  let structure = scenario.structure;
  if (needsDestination && !destination) {
    structure = pickup ? 'pickup_only' : structure;
  } else if (needsPickup && !pickup && destination) {
    structure = 'destination_only';
  }

  return {
    scenario: { ...scenario, structure },
    pickup,
    destination,
    tripDistanceM: pickup && destination ? metresBetween(pickup, destination) : null,
  };
}
